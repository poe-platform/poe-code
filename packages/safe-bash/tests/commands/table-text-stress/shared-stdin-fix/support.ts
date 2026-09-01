import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TableCase } from "../../table-text/cases.js";
import { runTable } from "../../table-text/helpers.js";
import { product, type Row } from "../support.js";

export const directory = dirname(fileURLToPath(import.meta.url));
export const root = resolve(directory, "../../../..");
export const runtime = resolve(directory, ".runtime");
export const sha = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export const sourcePaths = ["comm.ts", "index.ts", "internal.ts", "join.ts", "paste.ts", "README.md"].map(name => `src/commands/table-text/${name}`);
export async function direct(fixture: TableCase): Promise<Row> {
  const result = await runTable(fixture);
  const files: Record<string, string> = {};
  for (const name of Object.keys(fixture.files)) files[name] = Buffer.from(await result.fs.readFile(`/work/${name}`)).toString("hex");
  assert.deepEqual(files, fixture.files);
  return { exitCode: result.exitCode, stdoutHex: result.stdoutHex, stderrHex: Buffer.from(result.stderr).toString("hex"), files };
}
export async function shell(fixture: TableCase, pipeline: boolean): Promise<Row> {
  return product({ ...fixture, args: [...fixture.args] }, pipeline);
}
export function profileMatch(actual: Row, expected: Row): boolean {
  return actual.exitCode === expected.exitCode && actual.stdoutHex === expected.stdoutHex && Boolean(actual.stderrHex) === Boolean(expected.stderrHex) && JSON.stringify(actual.files) === JSON.stringify(expected.files);
}
