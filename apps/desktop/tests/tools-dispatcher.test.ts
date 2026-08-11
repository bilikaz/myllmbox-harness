// Dispatcher never-throw contract (ADR-0007) and the output cap that protects the model's context.
import { describe, expect, it } from "vitest";

import { cap, OUTPUT_CAP } from "../src/core/tools/base.ts";
import { cancelTool, execTool, toolFilter } from "../src/electron/tools.ts";
import { getConfig } from "../src/core/config/index.ts";

// The wire carries the config snapshot AND the call's container (main resolves the tool against it).
const wireLocal = { config: getConfig(), container: { type: "local", config: { root: "/tmp" } } as any };

describe("container gating (task4)", () => {
  const wire = { config: getConfig() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const names = (container?: any) => Object.keys(toolFilter(wire, { checkCanRun: true, container }));
  it("a workspace fs tool surfaces only in a Local container", () => {
    expect(names({ type: "local", config: { root: "/tmp" }, permissions: {} })).toContain("Read");
    expect(names({ type: "chat", config: {}, permissions: {} })).not.toContain("Read"); // non-workspace container → no fs tools
  });
});

describe("cap", () => {
  it("passes short output through untouched", () => {
    expect(cap("hello")).toBe("hello");
  });

  it("truncates beyond OUTPUT_CAP and says how much was dropped", () => {
    const big = "x".repeat(OUTPUT_CAP + 500);
    const capped = cap(big);
    expect(capped.length).toBeLessThan(big.length);
    expect(capped).toContain("output truncated");
    expect(capped).toContain("500 more bytes dropped");
  });
});

describe("execTool dispatcher", () => {
  it("rejects an empty tool name as an unknown tool", async () => {
    const r = await execTool({ id: "c1", name: "", arguments: "{}" }, wireLocal);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/unknown tool ""/);
  });

  it("rejects an unknown tool by name", async () => {
    const r = await execTool({ id: "c2", name: "Nuke", arguments: "{}" }, wireLocal);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/unknown tool "Nuke"/);
  });

  it("rejects malformed JSON arguments with the parse error and guidance", async () => {
    const r = await execTool({ id: "c3", name: "Read", arguments: "{broken" }, wireLocal);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/not valid JSON/);
    expect(r.output).toMatch(/Retry with a valid JSON object/);
  });

  it("never throws — a tool failure comes back as ok:false", async () => {
    // Read against a nonexistent cwd fails inside the tool, not as a throw.
    const r = await execTool(
      { id: "c4", name: "Read", arguments: JSON.stringify({ path: "/nope.txt" }) },
      { config: getConfig(), container: { type: "local", config: { root: "/definitely/not/a/real/dir" } } as any },
    );
    expect(r.ok).toBe(false);
  });

  it("cancelTool on an unknown call id is a no-op", () => {
    expect(() => cancelTool("never-ran")).not.toThrow();
  });
});
