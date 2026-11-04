import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "pgsql-parser";
import { parsePlPgSQL } from "libpg-query";
describe("database migration syntax", () => {
  it.each(
    readdirSync(resolve("supabase/migrations")).filter((name) =>
      name.endsWith(".sql"),
    ),
  )("parses %s and its PL/pgSQL bodies", async (name) => {
    const sql = readFileSync(resolve("supabase/migrations", name), "utf8");
    expect((await parse(sql)).stmts?.length).toBeGreaterThan(0);
    expect(await parsePlPgSQL(sql)).toHaveProperty("plpgsql_funcs");
  });
  it("parses the migration with PostgreSQL’s parser", async () => {
    const sql = readFileSync(
      resolve("supabase/migrations/202611030001_telos.sql"),
      "utf8",
    );
    const ast = await parse(sql);
    expect(ast.stmts?.length).toBeGreaterThan(70);
  });
  it("parses function bodies with PostgreSQL's PL/pgSQL parser", async () => {
    const sql = readFileSync(
      resolve("supabase/migrations/202611030001_telos.sql"),
      "utf8",
    );
    const ast = await parsePlPgSQL(sql);
    expect(ast).toHaveProperty("plpgsql_funcs");
  });
});
