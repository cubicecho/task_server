import { DATABASE_URL } from "../paths.ts";

export type Dialect = "sqlite" | "postgres";

/**
 * Which database `DATABASE_URL` asks for.
 *
 * SQLite is the default and asks nothing of anyone: a `file:` URL or a bare path, and the
 * built-in `node:sqlite` opens it. A `postgres://` URL moves the whole seam — table
 * definitions, driver, and boot-time DDL — over to postgres. Nothing else is understood, and
 * an unrecognised scheme is a typo worth failing on rather than guessing at.
 */
export const DIALECT: Dialect = detect(DATABASE_URL);

export const isPostgres = DIALECT === "postgres";

function detect(url: string): Dialect {
  if (/^postgres(ql)?:\/\//.test(url)) return "postgres";
  if (url.startsWith("file:") || url.startsWith("/") || url === ":memory:") return "sqlite";
  throw new Error(
    `DATABASE_URL must be a file: path or a postgres:// URL; got ${url}. See server/db/client.ts.`,
  );
}
