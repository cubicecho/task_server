import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..");
export const DATA_DIR = process.env.TASK_SERVER_DATA_DIR ?? path.join(ROOT, "data");
export const PORT = Number(process.env.PORT ?? 8787);

/** `file:` URLs and bare paths both land on a path; anything else is left for the pg seam. */
export const DATABASE_URL = process.env.DATABASE_URL ?? `file:${path.join(DATA_DIR, "tasks.db")}`;
