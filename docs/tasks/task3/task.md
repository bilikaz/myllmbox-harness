# Task 3 — Generation sessions: chat with a media model

## Goal

Let a person generate media directly, in a surface that **looks and works like a regular
chat** — except the model wired behind the composer is an image or video generator instead
of the text LLM. You start a generation session, send prompts, get images/videos back in the
transcript, iterate (refine, reference a prior result to edit) until it's done. Grouped in
the sidebar as **Images / Videos** sections beside **Chats**.

## Why

The media generators already exist but only the **agent** can call them (as tool calls).
People need to drive them directly. Modeling generation as "a chat whose model is a
generator" reuses the entire chat stack — sessions, transcript, message rendering, media
persistence, the composer — so it's mostly wiring, not new machinery. And keeping
generation in its **own sessions** (not inline in a chat) walls it off from agent context:
generations never cost a chat's tokens unless you deliberately **forward** one.

Depends on **task 2** — the 7 use-cases, the pinned-model resolution, and the input/output
capability model are what a generation session pins and what the composer reads.

## The model

- **A generation session is a thread** (many prompt→result turns, refine till done — a
  one-off is just a one-turn thread), exactly like a chat is a conversation. **Not**
  one-session-per-image.
- **The session pins a target** → a task-2 use-case + its model: **Image generation** or
  **Video generation** (text stays the existing chat). Reopening keeps the pinned target.
- **Send branches by target** — text → the LLM turn (unchanged); image/video → call the
  generation tool directly (no LLM turn) and append the result to the transcript.
- **Instruction → result, rendered as chat** — your prompt is the user message, the
  generated image/video is the response beneath it (reusing `Message` + `SavableMedia`).
  It's *not* wired as a synthetic agent tool-call; to any model it would only ever be a
  plain user image, and only if forwarded.
- **Endpoint/params by inputs** (task-2 model): an image session generates from a prompt,
  or **edits** when you attach/reference a prior image; a video session does t2v, or i2v/v2v
  when the model accepts image/video input.

## Scope

- **Sidebar sections Chats / Images / Videos** — the sidebar already groups by container
  type; the `image`/`video` type blocks are the generation sections (D2).
- **Composer send-branch** — a new "generation turn" path in the session store: append the
  prompt as a user message, run `ImageGenerate`/`ImageEdit`/`VideoGenerate` via
  `ctx.tools.run` (with the session's pinned model threaded through — see implementation.md),
  append the result message. Reuses media externalization + `img-N`/`vid-N` aliasing +
  persistence (the `media` repo) — **no new gallery store**.
- **Generation knobs from the shared config** — the composer surfaces the same knobs the
  agent uses: **aspect · quality** (image), **aspect · quality · duration** (video),
  initialized from `getAppConfig().imageGen/videoGen` defaults and bounded by the pinned
  model's `maxImageSize`/`maxVideoSize`. **Persisted per session** (pick once, reused).
- **Attachments gated by the pinned model's accepted inputs** (task 2's capability model):
  hidden for a text→image model, shown for edit-capable / i2v-capable models.
- **Composer inline model picker** — clicking the model chip by the input drops down the
  **models assigned to this session's use-case** (the priority pool) and switches inline —
  no redirect to settings. (Improves text sessions too.)
- **Right-panel is target-aware** — a text session keeps the **Context window** meter; a
  generation session shows the pinned model's **capabilities** instead (accepted inputs,
  max resolution/size, aspects) — read from task 2's capability model.
- **Send-to-chat** — every generated result (and gallery item) offers "Send to chat":
  forwards the media into a chat's composer as a user attachment. **The only path into agent
  context.**
- **Config gating** — a section whose use-case has no assigned model shows "configure a
  model" (→ Providers), mirroring the tools' `canRun()`.
- **Web + desktop parity** — it's the session stack, identical on both. Web generation needs
  the box's CORS (already true for chat). Gallery **page-compose** (A4 layout) is **not**
  part of this — desktop-only, separate.

## Decisions

- **D1 — Sessions are threads**, not one-per-generation (one-off = short thread). *(Settled.)*
- **D2 — Target = container type (settled).** `ContainerType` gains `image`/`video`; the
  container's type carries the target. Chosen over a session-level field because a session
  must belong to a container anyway (`containerId` never null, [ADR-0046](../../adr/0046-typed-containers.md)),
  so a field would still need a home container — the type is the natural carrier, and the
  sidebar already groups by it. `image`/`video` are deliberate first-class kinds, not the
  dead `remote` type task 1 pruned. `containerTarget(type)`: chat/local → `text`,
  image → `image`, video → `video`. **Audio** is the natural 5th type — deferred until an
  audio model is available to test.
- **D3 — Results are messages in the session** (user prompt + result), reusing the
  transcript — never synthetic assistant tool-calls in a model's history.
- **D4 — Generation is walled from agent context**; Send-to-chat is the deliberate bridge.
- **D5 — Storage rides the existing `media`/`messages` repos** — no separate gallery store.
- **D6 — Gallery lens (a flat grid view across a section's media)** — **defer to a follow-up**
  (threads are the v1 model; the grid is an optional view on top). *(Recommend defer.)*

## Acceptance criteria (done-whens)

1. Sidebar shows **Chats / Images / Videos**; creating an Images/Videos session pins the
   matching target/model and opens a chat-like view.
2. In an image session, a prompt generates an image into the transcript; attaching/referencing
   a prior image **edits** it; the whole thing persists + reopens like a chat (web + Electron).
3. In a video session, a prompt generates a video with an **elapsed-time / typical-duration
   indicator** (the tool call blocks while the video provider polls internally — no per-step
   %, but not a hung spinner); attachments appear only when the model accepts image/video input.
4. The composer's model chip is an **inline pool picker** (no settings redirect) in every
   session type; switching changes the active model.
5. The right panel shows **capabilities** in a generation session, the **context meter** in a
   chat.
6. **Send-to-chat** puts a generated image into a chat's composer; the agent then sees it as a
   user image (and can edit/reference it) — and generations are otherwise absent from chat
   context.
7. A section with no configured model shows "configure a model," not an error.
8. `pnpm typecheck` + `pnpm test` green.

## Out of scope

- **Gallery A4 page-composition** (`GalleryCompose`) as part of these sessions — desktop-only
  render port, its own feature.
- The **node-graph / ComfyUI canvas** — deferred; the box APIs are high-level, so it buys
  little until they expose more (discussed).
- Audio generation/recognition surfaces (the use-cases exist from task 2; audio is the
  natural 5th container type — a later section once an audio model is available to test).
- Any new backend or sync.
