import { getColumns, getTableName } from "drizzle-orm";
import { expect, test } from "vitest";
import * as pg from "../server/db/schema.pg.ts";
import * as sqlite from "../server/db/schema.sqlite.ts";

/**
 * `schema.ts` hands the postgres tables out under the SQLite tables' types, and that is only
 * honest while the two describe the same thing. A column added to one and forgotten in the
 * other would typecheck, pass every other test, and then fail at runtime — on whichever
 * database the author was not using. So compare them here.
 *
 * Storage types are deliberately not compared: differing is the entire point of the second
 * file. What has to match is the shape everything above `db/` relies on — the tables, their
 * columns, and for each column whether it is optional and what it defaults to.
 */

type Tables = Record<string, unknown>;

const tableNames = (schema: Tables) =>
  Object.entries(schema)
    .map(([key, table]) => `${key} → ${getTableName(table as never)}`)
    .sort();

test("both dialects define the same tables", () => {
  expect(tableNames(pg.schema)).toEqual(tableNames(sqlite.schema));
});

for (const key of Object.keys(sqlite.schema)) {
  test(`${key} has the same columns in both dialects`, () => {
    const left = getColumns(sqlite.schema[key as keyof typeof sqlite.schema] as never);
    const right = getColumns(pg.schema[key as keyof typeof pg.schema] as never);

    expect(Object.keys(right).sort()).toEqual(Object.keys(left).sort());

    for (const column of Object.keys(left)) {
      const a = left[column as keyof typeof left] as never as Column;
      const b = right[column as keyof typeof right] as never as Column;
      const describe = (c: Column) => ({
        name: c.name,
        notNull: c.notNull,
        primary: c.primary,
        hasDefault: c.hasDefault,
        // `default` is the literal in the DDL; the generated ones (`$defaultFn`) are
        // functions and only their presence is comparable.
        default: typeof c.default === "function" ? "fn" : c.default,
        enumValues: c.enumValues,
      });
      expect({ [column]: describe(b) }).toEqual({ [column]: describe(a) });
    }
  });
}

type Column = {
  name: string;
  notNull: boolean;
  primary: boolean;
  hasDefault: boolean;
  default: unknown;
  enumValues: string[] | undefined;
};
