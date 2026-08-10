// The engine's generate() turn (task 3) — the highest-risk wiring: it picks the tool by pool + refs,
// threads the pinned model into the call's `target`, carries edit references in `mediaRefs`, lands the
// result via completeGeneration, and cancels the in-flight call on stop. A fake ctx.tools records the
// dispatched ToolCallRequest so we can assert all of that without a real provider.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initTestCtx } from "./ctx.ts";
import type { Ctx } from "../src/core/ctx.ts";
import { SessionEngine } from "../src/core/sessions/engine.ts";
import { createSession, getSession, hydrate, setActive, setPinnedModel, setSessionStorage } from "../src/core/sessions/store.ts";
import { createContainer } from "../src/core/containers.ts";
import { addModel, addProvider, updateModel, updateProvider } from "../src/core/settings.ts";
import type { ContainerType } from "../src/core/containers.ts";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const anImage = () => ({ url: "data:image/png;base64,AAAA", mime: "image/png" });

let ctx: Ctx;
let engine: SessionEngine;
let run: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;

// A provider with an image model ("img-wire") and a video model ("vid-wire").
function seedModels(): { pid: string; imageMid: string } {
  const pid = addProvider();
  updateProvider(pid, { baseUrl: "http://gen/v1", name: "Gen" });
  const imageMid = addModel(pid, "img-wire");
  updateModel(pid, imageMid, { output: "image", input: { image: true } });
  const videoMid = addModel(pid, "vid-wire");
  updateModel(pid, videoMid, { output: "video" });
  return { pid, imageMid };
}

async function newGenSession(type: ContainerType): Promise<string> {
  const c = await createContainer({ type, name: type });
  const sid = createSession({ containerId: c!.id });
  setActive(sid);
  return sid;
}

beforeEach(async () => {
  ctx = initTestCtx();
  setSessionStorage(ctx.storage);
  await hydrate();
  run = vi.fn().mockResolvedValue({ images: [anImage()] });
  cancel = vi.fn();
  (ctx as unknown as { tools: unknown }).tools = { run, cancel };
  engine = new SessionEngine(ctx);
});

describe("engine.generate — tool selection", () => {
  it("image session with no attachment → ImageGenerate, and the pinned model rides as target", async () => {
    const { pid, imageMid } = seedModels();
    const sid = await newGenSession("image");
    setPinnedModel(sid, { providerId: pid, modelId: imageMid });

    await engine.generate("a red bird on a branch");

    expect(run).toHaveBeenCalledTimes(1);
    const call = run.mock.calls[0][0];
    expect(call.name).toBe("ImageGenerate");
    expect(call.target?.model?.id).toBe("img-wire"); // pinned pick threaded through, not the pool head
    // Result landed on the transcript (completeGeneration ran).
    expect(getSession(sid)!.messages.at(-1)!.images).toHaveLength(1);
  });

  it("image session WITH an attachment → ImageEdit, references + mediaRefs carry the alias", async () => {
    seedModels();
    const sid = await newGenSession("image");

    await engine.generate("make it warmer", { images: [anImage()] });

    const call = run.mock.calls[0][0];
    expect(call.name).toBe("ImageEdit");
    expect(JSON.parse(call.arguments).references).toEqual(["img-1"]); // the stamped alias
    expect(call.mediaRefs["img-1"]).toBeTruthy(); // content lane, same as the agent uses
  });

  it("video session → VideoGenerate", async () => {
    seedModels();
    run.mockResolvedValue({ videos: [{ url: "data:video/mp4;base64,AAAA", mime: "video/mp4" }] });
    const sid = await newGenSession("video");

    await engine.generate("a wave breaking");

    expect(run.mock.calls[0][0].name).toBe("VideoGenerate");
    expect(getSession(sid)!.messages.at(-1)!.videos).toHaveLength(1);
  });
});

describe("engine.generate — stop", () => {
  it("cancels the in-flight call and records a Stop as a cancel, not a failure", async () => {
    seedModels();
    let release: (v: unknown) => void = () => {};
    run.mockImplementation(() => new Promise((r) => (release = r)));
    const sid = await newGenSession("image");

    const p = engine.generate("something slow");
    await tick(); // let generate() get past ensureLoaded and register the call id
    const call = run.mock.calls[0][0];
    engine.stopGeneration(sid);
    expect(cancel).toHaveBeenCalledWith(call.id);

    release({ images: [anImage()] }); // even if the tool returns, a Stopped turn isn't filled
    await p;

    const msgs = getSession(sid)!.messages;
    expect(msgs.at(-1)!.role).toBe("user"); // blank placeholder dropped — the prompt stays
    expect(getSession(sid)!.meta.errorKind).toBeUndefined(); // cancel ≠ error
  });
});

describe("engine.generate — one at a time", () => {
  it("a second submit in the same frame is rejected (no parallel generation)", async () => {
    seedModels();
    let release: (v: unknown) => void = () => {};
    run.mockImplementation(() => new Promise((r) => (release = r)));
    const sid = await newGenSession("image");

    const p1 = engine.generate("one");
    const p2 = engine.generate("two"); // synchronous claim already set streaming → this must bail
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(getSession(sid)!.messages.filter((m) => m.role === "user")).toHaveLength(1);

    release({ images: [anImage()] });
    await Promise.all([p1, p2]);
  });
});
