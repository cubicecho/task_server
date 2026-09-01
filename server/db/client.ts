import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { migrate as migrateNode } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import { DATA_DIR, DATABASE_URL } from "../paths.ts";
import { relations } from "./schema.ts";

/**
 * The database. Postgres either way — the only question is whose.
 *
 * With no `DATABASE_URL`, the server runs PGlite: postgres itself, compiled to WebAssembly and
 * running inside this process against a directory under `data/`. A fresh clone boots with
 * nothing installed and nothing to start, and it is the same engine, the same SQL and the same
 * types as the deployed thing — which is the whole reason for it rather than a second dialect.
 *
 * With a `postgres://` URL it is a real postgres server over node-postgres: more than one
 * server process, a managed backup, storage that is not the app's own disk.
 *
 * The choice is made here and nowhere else. Everything above this file is written against one
 * `db` and one set of tables.
 */

const server = /^postgres(ql)?:\/\//.test(DATABASE_URL);

const pool = server ? new pg.Pool({ connectionString: DATABASE_URL }) : null;

// Anything that is not a `postgres://` URL is where PGlite keeps its data: a directory, or one
// of its own schemes — `memory://` for a database that lives and dies with the process, which
// is what the tests run on.
const store = DATABASE_URL || path.join(DATA_DIR, "pg");

// PGlite creates its own directory but not the parent, and `data/` is gitignored — so a fresh
// clone has none to create it in. A scheme is not a path and is left alone.
if (!server && !store.includes("://")) fs.mkdirSync(store, { recursive: true });

/**
 * Whether a pid is a process that still exists. Signal 0 checks without delivering anything;
 * `EPERM` is a live process owned by somebody else, which counts.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Claims the data directory for this process, or refuses to start.
 *
 * PGlite does not lock what it opens. Two processes on one directory both succeed, and then
 * each holds its own postgres over the same files: they do not see each other's writes — a row
 * committed by one stays invisible to the other indefinitely — and whichever flushes last
 * decides what survives. Boot is the loud version, because both run migrations, and PGlite
 * aborts the WASM runtime mid-`CREATE SCHEMA` and takes the process with it. The silent
 * divergence is the one worth fearing more.
 *
 * `DATA_DIR` is a fixed path, so this needs no misconfiguration to reach: `npm start` beside a
 * running `npm run dev`, or a container bind-mounting `data/` next to either.
 *
 * A pid in a file, and the limits of one are the reason to say what this does and does not
 * catch. A pid that is gone leaves a stale lock, which is taken over rather than honoured, so a
 * crash does not leave the directory unbootable. A pid reused by an unrelated process is the
 * false positive, and it fails the safe way — the server refuses to boot and names the pid to
 * look at, rather than quietly forking the database.
 *
 * What it catches is two servers sharing a pid namespace: `npm start` beside a running
 * `npm run dev`, or a second `npm run dev` in the same checkout. What it cannot catch is a
 * container and a host process over the bind-mounted `./data` in `docker-compose.yml`, because
 * neither can see the other's pids and each reads the other's lock as stale. That case is no
 * worse than it is today and no better, and the answer to it is `DATABASE_URL` — one postgres
 * that does its own locking, which is what more than one server was always going to need.
 *
 * Upstream has both halves open as electric-sql/pglite#892 and #1053; until the first lands,
 * the lock is ours to take.
 */
function claim(lock: string): void {
  // Twice, not once: finding the lock stale and replacing it is two steps, and another process
  // may take it in between. The second pass then finds a live holder and refuses, as it should.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lock, `${process.pid}\n`, { flag: "wx" });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      const held = Number(fs.readFileSync(lock, "utf8").trim());
      if (held && held !== process.pid && alive(held)) {
        throw new Error(
          `The data directory ${store} is already open by process ${held}.\n` +
            "Two servers on one PGlite directory stop seeing each other's writes, so this one " +
            "is stopping instead. Close the other server, or give this one its own directory " +
            "with TASK_SERVER_DATA_DIR, or point both at one postgres with DATABASE_URL.",
        );
      }

      fs.rmSync(lock, { force: true });
    }
  }
  throw new Error(`Could not claim the data directory ${store}: ${lock} keeps being retaken.`);
}

// Held for the life of the process, and released however it ends — `exit` runs after the
// signal handlers in `index.ts` have had their turn, and after an uncaught throw.
if (!server && !store.includes("://")) {
  const lock = `${store}.lock`;
  claim(lock);
  process.on("exit", () => {
    try {
      if (Number(fs.readFileSync(lock, "utf8").trim()) === process.pid) fs.rmSync(lock);
    } catch {
      // Already gone, or never ours to remove. Either way there is nothing to release.
    }
  });
}

const embedded = server ? null : new PGlite(store);

/**
 * PGlite's database is handed out under node-postgres' type. The two are the same postgres to
 * the query builder — same dialect, same SQL, same row shapes — and differ only in `$client`,
 * the raw handle, which nothing above this file reaches for.
 */
export const db = pool
  ? drizzleNode({ client: pool, relations })
  : (drizzlePglite({
      client: embedded as PGlite,
      relations,
    }) as unknown as ReturnType<typeof drizzleNode<typeof relations>>);

/**
 * Applies the generated migrations under `drizzle/`.
 *
 * The two drivers have one migrator each and they are not interchangeable, which is the only
 * reason this lives here rather than in `migrate.ts`: choosing between them is choosing which
 * postgres, and that decision belongs to this file alone.
 */
export const runMigrations = (migrationsFolder: string): Promise<unknown> =>
  pool
    ? migrateNode(db, { migrationsFolder })
    : migratePglite(db as unknown as PgliteDatabase<typeof relations>, { migrationsFolder });
