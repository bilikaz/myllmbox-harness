// Data-version gate. The local stores (sqlite/idb) hold the whole Session/Message as a JSON blob, so a
// SHAPE change usually loads fine (unknown fields drop, missing ones default). But a genuinely breaking
// change can't be migrated cheaply — we'd rather WIPE than carry back-compat code. So data carries a
// version: on boot, if the stored version is OLDER than the build's DATA_VERSION, the provider is
// cleared and re-seeded fresh.
//
// Bump DATA_VERSION only for a genuinely breaking local change. An install with no stamp yet is GRANDFATHERED
// (stamped, not wiped) — a forward-compatible shape change (e.g. the 0.2.0 identity-vs-runtime regroup, which
// just resets runtime status on old rows) keeps the user's chat history; the gate is the lever for when a
// change truly can't load old data.

import { rootLog } from "../../lib/logger/index.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { StorageEngine } from "./engine.ts";

const log = rootLog.child("storage.version");
const KEY = "myllmbox-harness:data-version";

// 0.2.0: the message/session reshape (commit-on-landing + identity-vs-runtime meta). Old local rows still
// load (forward-compatible), so this bump grandfathers rather than wipes — it sets the baseline so the NEXT
// breaking bump has something to compare against.
export const DATA_VERSION = 2;

export async function gateDataVersion(engine: StorageEngine): Promise<void> {
  let stored = 0;
  try {
    stored = Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return; // no localStorage (some headless host) — skip the gate entirely
  }
  // stored === 0 → never stamped (fresh install, or a pre-versioning one we grandfather). Only an OLDER
  // stamp triggers a wipe.
  if (stored && stored < DATA_VERSION) {
    log.warn("wipe", { hint: "local data is from an older incompatible version — clearing", stored, current: DATA_VERSION });
    await engine.repos().wipe().catch((e: unknown) => log.warn("wipe_failed", { error: errorMessage(e) }));
  }
  try {
    localStorage.setItem(KEY, String(DATA_VERSION));
  } catch {
    /* ignore — best effort */
  }
}
