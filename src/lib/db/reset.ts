import { powersync } from "./client";

export const LAST_USER_KEY = "squad.lastConnectedUserId.v2";

// Throw away all local state WITHOUT going through PowerSync. That's the point:
// this runs when PowerSync itself is the broken thing — a torn OPFS file after
// storage was cleared or a tab was killed mid-write surfaces as
// "powersync_control: internal SQLite call returned CORRUPT", and every call
// that touches the database (including disconnectAndClear) fails from then on.
//
// Deletes the OPFS files backing squad.db, the connect marker, and any
// service-worker registration — the PWA precaches the app shell, and a
// half-broken shell survives an ordinary reload.
export async function hardResetLocalState(): Promise<void> {
  try {
    localStorage.removeItem(LAST_USER_KEY);
    // Also clean up the pre-OPFS marker if it's still around.
    localStorage.removeItem("squad.lastConnectedUserId");
  } catch {
    // localStorage may be unavailable (private mode) — nothing to clean up.
  }

  try {
    const root = await navigator.storage.getDirectory();
    // @ts-expect-error — values() exists in browsers but not yet in the TS DOM
    // lib for FileSystemDirectoryHandle.
    for await (const entry of root.values()) {
      try {
        await root.removeEntry(entry.name, { recursive: true });
      } catch (err) {
        // A lock held by another context can block removal — keep going so one
        // stuck file doesn't leave the rest behind.
        console.warn(`[powersync] couldn't remove OPFS entry ${entry.name}:`, err);
      }
    }
  } catch (err) {
    console.warn("[powersync] OPFS cleanup failed:", err);
  }

  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    for (const reg of registrations ?? []) await reg.unregister();
  } catch (err) {
    console.warn("[powersync] service worker unregister failed:", err);
  }
}

// Wipe local data and reload, so the next boot re-downloads every bucket.
//
// Prefers PowerSync's own disconnectAndClear (it tears down the sync worker
// cleanly), but falls back to the hard reset when that throws — which is
// exactly what happens on a corrupt database, the case where this matters most.
// Either way the marker is cleared and the page reloads.
export async function resetLocalDatabase(): Promise<void> {
  try {
    await powersync.disconnectAndClear();
    try {
      localStorage.removeItem(LAST_USER_KEY);
    } catch {
      // See above — a missing localStorage just means one less thing to clear.
    }
  } catch (err) {
    console.warn("[powersync] disconnectAndClear failed, hard resetting:", err);
    await hardResetLocalState();
  }
  window.location.reload();
}
