import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

// Independently recorded from qpdf 12.4.2, including both default schemas.
for (const [fixture, oracle, offset] of [["qpdf-prefixed-table.pdf", "qpdf-json-sections.json", 14], ["qpdf-json-pages.pdf", "qpdf-json-pages.json", 0]] as const) {
const cases: { version: number; keys: string[]; mode?: string; expected: unknown }[] = JSON.parse(readFileSync(new URL(`../../pdf-ast/src/fixtures/${oracle}`, import.meta.url), "utf8"));
const input = readFileSync(new URL(`../../pdf-ast/src/fixtures/${fixture}`, import.meta.url)).subarray(offset);
for (const { version, keys, mode = "none", expected } of cases) it(`matches native ${fixture} JSON ${version} sections ${keys.join(",") || "default"}`, async () => {
  const args = ["in.pdf", `--json=${version}`, `--json-stream-data=${mode}`, ...keys.map(key => `--json-key=${key}`)];
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  let stdout = "", stderr = "";
  const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } } });
  for (const output of [{ ...result, stdout, stderr }, runQpdfCliSync(args, new Map([["in.pdf", input]])), await runQpdfCli(args, new Map([["in.pdf", input]]))]) {
    assert.equal(output.exitCode, 0, output.stderr); assert.equal(output.stderr, "");
    assert.deepEqual(JSON.parse(output.stdout), expected);
  }
  assert.deepEqual(await fs.readdir("/scratch"), []);
  assert.deepEqual(Buffer.from(await fs.readFile("/in.pdf")), input);
});
}
