// Unified Settings registry (ADR-0042) — providers → models → per-pool assignments. A model declares
// output + accepted inputs; that in/out GATES which of the 7 use-case pools it may join (`qualifies`).
// Pool membership is explicit (assignModels); changing in/out prunes pools a model no longer qualifies
// for. A fresh install seeds NOTHING (D1) — an unassigned/endpoint-less pool resolves null (tool inert).
import { beforeEach, describe, expect, it } from "vitest";

import {
  addModel,
  addProvider,
  assignModels,
  getMediaRegistry,
  providerCaps,
  removeModel,
  removeProvider,
  resolveMediaProvider,
  resolveModelRef,
  slotOptions,
  updateModel,
  updateProvider,
} from "../src/core/settings.ts";
import { hydrateConsumers } from "../src/core/storage/consumer.ts";
import { initTestCtx } from "./ctx.ts";

// A provider with one image-output model "m1" (fresh install starts empty — nothing seeded).
function seedProvider(): { pid: string; mid: string } {
  const pid = addProvider();
  updateProvider(pid, { baseUrl: "http://a/v1", name: "A" });
  const mid = addModel(pid, "m1");
  updateModel(pid, mid, { output: "image" });
  return { pid, mid };
}

const providerById = (id: string) => getMediaRegistry().providers.find((p) => p.id === id);

beforeEach(() => initTestCtx());

describe("providers + models", () => {
  it("switching a provider's dialect preserves its models (no collapse)", () => {
    const pid = addProvider();
    updateProvider(pid, { baseUrl: "http://b/" });
    addModel(pid, "x1");
    addModel(pid, "x2");

    updateProvider(pid, { api: "anthropic" });
    const p = providerById(pid)!;
    expect(p.models.map((m) => m.modelId)).toEqual(["x1", "x2"]);
    expect(p.api).toBe("anthropic");
  });

  it("providerCaps constrains the output modalities a model can declare (media is OpenAI-only)", () => {
    expect(providerCaps("openai")).toEqual(["text", "image", "video", "audio"]);
    expect(providerCaps("anthropic")).toEqual(["text"]);
    expect(providerCaps("gemini")).toEqual(["text"]);
  });

  it("a cosmos wire id arrives pre-marked for the JSON enhancer", () => {
    const pid = addProvider();
    const mid = addModel(pid, "nvidia/Cosmos3-T2I");
    expect(providerById(pid)!.models.find((x) => x.id === mid)?.promptStyle).toBe("cosmos-json");
  });

  it("a fresh install adds a text (chat) model that accepts text by default", () => {
    const pid = addProvider();
    const mid = addModel(pid, "chat-1");
    const m = providerById(pid)!.models.find((x) => x.id === mid)!;
    expect(m.output).toBe("text");
    expect(m.input?.text).toBe(true);
  });
});

describe("the gate + assignment + resolution", () => {
  it("qualifies gates which pools a model appears as an option for", () => {
    const { pid, mid } = seedProvider();
    // image output → an `image` option, and nothing else.
    expect(slotOptions("image", getMediaRegistry()).map((o) => o.ref.modelId)).toEqual([mid]);
    expect(slotOptions("text", getMediaRegistry())).toEqual([]);
    expect(slotOptions("video", getMediaRegistry())).toEqual([]);

    // a text model that also accepts image → `text` AND `imageRec`, never `image`.
    const chat = addModel(pid, "chat");
    updateModel(pid, chat, { output: "text", input: { text: true, image: true } });
    expect(slotOptions("text", getMediaRegistry()).map((o) => o.ref.modelId)).toEqual([chat]);
    expect(slotOptions("imageRec", getMediaRegistry()).map((o) => o.ref.modelId)).toEqual([chat]);
    expect(slotOptions("image", getMediaRegistry()).map((o) => o.ref.modelId)).toEqual([mid]);
  });

  it("assignment is explicit + ordered, and losing qualification prunes the pool entry", () => {
    const { pid, mid } = seedProvider();
    const mid2 = addModel(pid, "m2");
    updateModel(pid, mid2, { output: "image" });

    assignModels("image", [{ providerId: pid, modelId: mid }, { providerId: pid, modelId: mid2 }]);
    const pool = getMediaRegistry().assignments.image!;
    expect(pool).toHaveLength(2);
    expect(pool[0].modelId).toBe(mid); // priority position preserved

    // mid stops outputting image → pruned from the image pool (the gate), mid2 stays.
    updateModel(pid, mid, { output: "video" });
    expect(getMediaRegistry().assignments.image).toEqual([{ providerId: pid, modelId: mid2 }]);
  });

  it("slotOptions lists 'provider : model' for qualifying models only", () => {
    const { pid, mid } = seedProvider();
    expect(slotOptions("image", getMediaRegistry())).toEqual([{ ref: { providerId: pid, modelId: mid }, label: "A : m1" }]);
    expect(slotOptions("video", getMediaRegistry())).toEqual([]);
  });

  it("resolution flattens provider + model and goes inert without an endpoint", () => {
    const { pid, mid } = seedProvider();
    updateModel(pid, mid, { maxImageSize: "1024x1024" });
    assignModels("image", [{ providerId: pid, modelId: mid }]);
    expect(resolveMediaProvider("image")).toMatchObject({
      provider: { name: "A", type: "openai", baseUrl: "http://a/v1" },
      model: { id: "m1", maxImageSize: "1024x1024" },
    });

    updateProvider(pid, { baseUrl: "" });
    expect(resolveMediaProvider("image")).toBeNull();
  });

  it("resolveModelRef resolves a pinned pick directly, independent of pool membership (task 3)", () => {
    const { pid, mid } = seedProvider();
    updateModel(pid, mid, { maxImageSize: "1024x1024" });
    // No assignModels: the composer's pinned pick is resolved by ref, not by pool priority — the
    // generation turn must run THIS model even if it isn't (or isn't first) in the pool.
    expect(resolveModelRef({ providerId: pid, modelId: mid })).toMatchObject({
      provider: { name: "A", type: "openai", baseUrl: "http://a/v1" },
      model: { id: "m1", maxImageSize: "1024x1024" },
    });
    expect(resolveModelRef({ providerId: pid, modelId: "nope" })).toBeNull();
  });

  it("a structurally-malformed stored row hydrates to DEFAULTS (empty) instead of throwing", async () => {
    const ctx = initTestCtx();
    // Legacy/corrupt: services.text is a single object, not the ordered array resolvePools maps over.
    await ctx.storage.repos().settings.put({
      key: "myllmbox-harness:settings",
      value: JSON.stringify({ providers: [], services: { text: { providerId: "x", modelId: "y" } } }),
    });
    await expect(hydrateConsumers()).resolves.toBeDefined();
    expect(getMediaRegistry().providers).toEqual([]);
    expect(getMediaRegistry().assignments).toEqual({});
  });

  it("removing a model or provider prunes its assignments", () => {
    const { pid, mid } = seedProvider();
    assignModels("image", [{ providerId: pid, modelId: mid }]);
    removeModel(pid, mid);
    expect(getMediaRegistry().assignments.image).toBeUndefined();

    const mid2 = addModel(pid, "m2");
    updateModel(pid, mid2, { output: "image" });
    assignModels("image", [{ providerId: pid, modelId: mid2 }]);
    removeProvider(pid);
    expect(providerById(pid)).toBeUndefined();
    expect(resolveMediaProvider("image")).toBeNull();
  });
});

describe("context length + dialect reconcile", () => {
  // D9/A3 canary: the exact regression the merge introduced — a detected window must ride onto a
  // freshly-added model, not get dropped on the Detect→Add flow.
  it("addModel carries the provider's detected context length onto a new model", () => {
    const pid = addProvider();
    updateProvider(pid, { baseUrl: "http://a/v1", modelLimits: { "chat-1": 65536 } });
    const mid = addModel(pid, "chat-1");
    expect(providerById(pid)!.models.find((m) => m.id === mid)!.contextLength).toBe(65536);
    // a wire id with no reported limit stays unset — the manual Context length field is the fallback.
    const mid2 = addModel(pid, "chat-2");
    expect(providerById(pid)!.models.find((m) => m.id === mid2)!.contextLength).toBeUndefined();
  });

  it("switching a provider's dialect clamps a model's output to the new caps", () => {
    const pid = addProvider();
    updateProvider(pid, { baseUrl: "http://a/v1" });
    const mid = addModel(pid, "img-1");
    updateModel(pid, mid, { output: "image" }); // legal on openai
    expect(providerById(pid)!.models.find((m) => m.id === mid)!.output).toBe("image");
    updateProvider(pid, { api: "anthropic" }); // anthropic outputs text only → clamp
    expect(providerById(pid)!.models.find((m) => m.id === mid)!.output).toBe("text");
  });
});
