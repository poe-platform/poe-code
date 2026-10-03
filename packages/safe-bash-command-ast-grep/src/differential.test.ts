import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { findMatches, parseCode, rewriteCode } from "@poe-code/ts-ast";
import { run } from "./test-support.js";

interface Row {
  file: string;
  text: string;
  range: unknown;
  replacement?: string;
  metaVariables: unknown;
}
interface Fixture {
  name: string; lang: string; source: string; pattern: string; rewrite: string;
  matches: Row[]; updated: string;
}
const corpus = JSON.parse(readFileSync(new URL("../fixtures/native.json", import.meta.url), "utf8")) as {
  version: string; cases: Fixture[];
};
// Compare every required field, including the complete capture maps and positions.
const project = (rows: Row[], file?: string) => rows.map(row => ({
  file: file ?? row.file, text: row.text, range: row.range,
  replacement: row.replacement, metaVariables: row.metaVariables
}));
const native = [process.env.AST_GREP_BINARY, "ast-grep", "sg"].find(tool => tool &&
  spawnSync(tool, ["--version"], { timeout: 2000, encoding: "utf8" }).stdout?.startsWith("ast-grep "));

for (const live of [false, true]) {
  describe.skipIf(live && !native)(live ? "installed native ast-grep" : corpus.version, () => {
    it.each(corpus.cases)("matches and rewrites $name", async fixture => {
      const { source, lang, pattern, rewrite } = fixture;
      let expected = fixture.matches, updated = fixture.updated;
      if (live) {
        const args = ["run", "--stdin", "-l", lang, "-p", pattern, "-r", rewrite];
        const matches = spawnSync(native!, [...args, "--json=compact"], {
          input: source, encoding: "utf8", timeout: 5000
        });
        expect(matches.error).toBeUndefined();
        expect(matches.status, matches.stderr).toBe(0);
        expected = JSON.parse(matches.stdout);
        const result = spawnSync(native!, [...args, "--update-all"], {
          input: source, encoding: "utf8", timeout: 5000
        });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        // Native stdin rendering appends one display newline; file rewrites do not.
        updated = result.stdout.slice(0, -1);
      }
      expect(expected.length).toBeGreaterThan(0);
      const tree = parseCode(source, lang);
      expect(findMatches(tree, pattern).map(m => m.node.text)).toEqual(expected.map(m => m.text));
      expect(rewriteCode(tree, pattern, rewrite)).toBe(updated);
      for (const command of ["ast-grep", "sg"]) {
        const file = `input.${lang}`;
        const result = await run(["run", "-l", lang, "-p", pattern, "-r", rewrite,
          "--json=compact", command === "sg" ? "--update-all" : "-U", file],
          { ["/" + file]: source }, "", {}, { command });
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        expect(project(JSON.parse(result.stdout))).toEqual(project(expected, file));
        expect(new TextDecoder().decode(await result.fs.readFile("/" + file))).toBe(updated);
      }
    });
  });
}

it("updates a wide command corpus and leaves over-budget files untouched", async () => {
  const source = Array.from({ length: 200 }, (_, i) => `/* 😀 */ f(v${i});`).join("\n");
  const args = ["-p", "f($X)", "-r", "g($X)", "-U", "--json=compact", "input.ts"];
  const accepted = await run(args, { "/input.ts": source }, "", { maxMatches: 200 });
  expect(accepted.exitCode).toBe(0);
  expect(JSON.parse(accepted.stdout)).toHaveLength(200);
  expect(new TextDecoder().decode(await accepted.fs.readFile("/input.ts")))
    .toBe(Array.from({ length: 200 }, (_, i) => `/* 😀 */ g(v${i});`).join("\n"));
  const rejected = await run(args, { "/input.ts": source }, "", { maxMatches: 199 });
  expect(rejected.exitCode).toBe(2);
  expect(rejected.stderr).toContain("match limit exceeded");
  expect(new TextDecoder().decode(await rejected.fs.readFile("/input.ts"))).toBe(source);
});
