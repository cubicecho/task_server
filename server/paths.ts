import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..");
export const DATA_DIR = process.env.TASK_SERVER_DATA_DIR ?? path.join(ROOT, "data");
export const PORT = Number(process.env.PORT ?? 8787);

/**
 * A postgres server to connect to. Empty — the default — runs PGlite inside the process
 * against `DATA_DIR`, so a fresh clone needs no database of its own. See `db/client.ts`.
 */
export const DATABASE_URL = process.env.DATABASE_URL ?? "";
