// Generation turn (task 3): a media session's "turn" is the user prompt + a media RESULT stamped onto the
// assistant placeholder — no LLM loop runs. completeGeneration must land the produced media (with img-N/
// vid-N aliases) on that placeholder so it shows in the transcript; failGeneration must record the reason
// and flag the error. These are the store-level canaries for "generation output reaches the transcript".
import { beforeAll, describe, expect, it } from "vitest";

import { initTestCtx } from "./ctx.ts";
import {
  completeGeneration,
  createSession,
  failGeneration,
  getSession,
  hydrate,
  pushTurn,
  setSessionStorage,
} from "../src/core/sessions/store.ts";

const img = (name: string) => ({ url: "data:image/png;base64,AAAA", mime: "image/png", name });

beforeAll(async () => {
  setSessionStorage(initTestCtx().storage);
  await hydrate();
});

describe("completeGeneration", () => {
  it("fills the assistant placeholder with the media and stamps aliases", () => {
    const sid = createSession({ containerId: "c1" });
    pushTurn(sid, "a red bird on a branch"); // → [user, empty assistant placeholder]
    completeGeneration(sid, { images: [img("bird")] });

    const msgs = getSession(sid)!.messages;
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.images).toHaveLength(1);
    expect(last.images![0].ref).toBe("img-1"); // aliased so it can be referenced later
    expect(getSession(sid)!.meta.mediaSeq).toBe(2); // counter advanced past img-1
  });
});

describe("failGeneration", () => {
  it("writes the reason into the placeholder and flags the error", () => {
    const sid = createSession({ containerId: "c1" });
    pushTurn(sid, "an impossible scene");
    failGeneration(sid, "video model timed out");

    const msgs = getSession(sid)!.messages;
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.text).toBe("video model timed out");
    expect(getSession(sid)!.meta.errorKind).toBe("other");
  });
});
