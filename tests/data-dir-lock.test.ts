import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

const FIXTURE = fileURLToPath(new URL("./fixtures/hold-data-dir.mjs", import.meta.url));

const running: ChildProcess[] = [];

afterEach(() => {
  for (const child of running.splice(0)) child.kill("SIGKILL");
});

/**
 * Boots the database against `dir` in a process of its own, and resolves with the first line it
 * prints — `HELD` or `REFUSED …`.
 *
 * A child rather than an import: the lock is claimed once, at module scope, by whichever process
 * holds the PGlite. Two of those is the thing under test and one process cannot be both.
 */
function boot(dir: string): Promise<{ line: string; child: ChildProcess }> {
  const child = spawn(process.execPath, [FIXTURE], {
    // `memory://` is what vitest puts in the environment, and a database in memory has no
    // directory to contend for. This is the file-backed path the lock exists for.
    env: { ...process.env, DATABASE_URL: "", TASK_SERVER_DATA_DIR: dir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  running.push(child);

  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk;
      const line = out.split("\n").find((candidate) => /^(HELD|REFUSED)/.test(candidate));
      if (line) resolve({ line, child });
    });
    child.on("error", reject);
    child.on("exit", () => reject(new Error(`exited without a verdict: ${out}`)));
  });
}

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "task-server-lock-"));

test("a second server refuses the data directory the first one holds", async () => {
  const dir = temp();

  const first = await boot(dir);
  expect(first.line).toBe("HELD");

  const second = await boot(dir).catch((error: Error) => ({ line: error.message, child: null }));
  expect(second.line).toMatch(/already open by process \d+/);
  // The refusal has to say what to do about it, or it is just a stop.
  expect(second.line).toMatch(/TASK_SERVER_DATA_DIR|DATABASE_URL/);
});

test("the lock is released when the server ends, and the directory reopens", async () => {
  const dir = temp();

  const first = await boot(dir);
  expect(first.line).toBe("HELD");
  const ended = new Promise((resolve) => first.child.once("exit", resolve));
  first.child.kill("SIGTERM");
  await ended;

  const second = await boot(dir);
  expect(second.line).toBe("HELD");
});

test("a lock left by a process that is gone is taken over, not honoured", async () => {
  const dir = temp();
  fs.mkdirSync(path.join(dir, "pg"), { recursive: true });

  // A pid that certainly is not running: one we watched exit.
  const corpse = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => corpse.once("exit", resolve));
  fs.writeFileSync(path.join(dir, "pg.lock"), `${corpse.pid}\n`);

  // A crash leaves the lock behind. Honouring it would make the crash permanent.
  const booted = await boot(dir);
  expect(booted.line).toBe("HELD");
});
