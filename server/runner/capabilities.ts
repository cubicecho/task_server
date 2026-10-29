import {
  errorMessage,
  expireCapabilities,
  exportCapabilities,
  importCapabilities,
} from "@cubicecho/agent-core";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { endpointCapabilities, SETTINGS_ID } from "../db/schema.ts";

/**
 * How long a learned refusal is believed. A server upgraded behind the same URL — a llama.cpp
 * that now compiles the grammar, a proxy that learned `stream_options` — is otherwise sent the
 * downgraded request for as long as the snapshot keeps being saved, which is forever. A day
 * costs one refused request per endpoint and model per day, against a downgrade nobody would
 * notice. Measured from when the endpoint was first met, not from the boot that imported it.
 */
export const CAPABILITY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The endpoints as last written, so a run that learned nothing writes nothing. */
let saved: string | undefined;
let pending: Promise<boolean> = Promise.resolve(false);

/**
 * Latches what the stored snapshot says was refused, then forgets what has aged out.
 *
 * Never throws: the snapshot only saves requests, so a row this release cannot read — another
 * snapshot version, a hand-edited blob — is logged and left for the next save to overwrite, and
 * the server boots as it did before there was one.
 *
 * @returns Whether a snapshot was found and applied.
 */
export async function restoreCapabilities(): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(endpointCapabilities)
      .where(eq(endpointCapabilities.id, SETTINGS_ID));
    if (!row) {
      return false;
    }
    if (!importCapabilities(row.snapshot)) {
      console.warn("[capabilities] stored snapshot is not one this version reads; ignoring it");
      return false;
    }
    // What the row holds, so the first run after boot does not write it back unchanged. What
    // expires next is then a difference, and the save after it drops it from the row.
    saved = JSON.stringify((row.snapshot as { endpoints: unknown }).endpoints);
    expireCapabilities(CAPABILITY_MAX_AGE_MS);
    return true;
  } catch (error) {
    console.warn(`[capabilities] could not restore: ${errorMessage(error)}`);
    return false;
  }
}

/**
 * Writes the snapshot if it moved since the last write, sweeping expired latches first.
 *
 * Called when a run ends rather than when a latch is learned, since agent-core has no hook for
 * the latter, and a run is where every refusal is met. Compared before writing, so the write is
 * as rare as the lesson — a handful in a server's life — rather than one per run. Chained, so
 * two runs ending in one tick do not race their upserts.
 *
 * @returns Whether anything was written.
 */
export function persistCapabilities(): Promise<boolean> {
  pending = pending.then(write, write);
  return pending;
}

async function write(): Promise<boolean> {
  try {
    expireCapabilities(CAPABILITY_MAX_AGE_MS);
    const snapshot = exportCapabilities();
    const endpoints = JSON.stringify(snapshot.endpoints);
    if (endpoints === saved) {
      return false;
    }
    if (saved === undefined && !Object.keys(snapshot.endpoints).length) {
      // Nothing learned yet and nothing known to be stored: an empty write would only clear a
      // row that `restoreCapabilities` could not read, which the first real lesson does anyway.
      saved = endpoints;
      return false;
    }
    await db
      .insert(endpointCapabilities)
      .values({ id: SETTINGS_ID, snapshot })
      .onConflictDoUpdate({
        target: endpointCapabilities.id,
        set: { snapshot, savedAt: new Date() },
      });
    saved = endpoints;
    return true;
  } catch (error) {
    console.warn(`[capabilities] could not save: ${errorMessage(error)}`);
    return false;
  }
}

/** Forgets what was last written, as a fresh process would. For tests simulating a restart. */
export function forgetSaved() {
  saved = undefined;
}
