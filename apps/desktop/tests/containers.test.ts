// containerTarget is the router the composer uses to decide where a session's turns go: text kinds
// (chat/local) target the LLM; generation kinds (image/video) target their media pool. The mapping is
// total over ContainerType and must default undefined → text, so a session never mis-routes to a media
// pool before its container resolves. (task 3)
import { describe, expect, it } from "vitest";

import { containerTarget } from "../src/core/containers.ts";

describe("containerTarget", () => {
  it("maps text kinds (and undefined) to the text pool", () => {
    expect(containerTarget("chat")).toBe("text");
    expect(containerTarget("local")).toBe("text");
    expect(containerTarget(undefined)).toBe("text");
  });

  it("maps generation kinds to their own media pool", () => {
    expect(containerTarget("image")).toBe("image");
    expect(containerTarget("video")).toBe("video");
  });
});
