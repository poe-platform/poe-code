import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Json } from "../../../../src/commands/structured/limits.js";

export interface NativeCase {
  id: string;
  argv: string[];
  input: string;
  direct?: { input: Json; separator: Json };
  status: number;
  stdout: string;
  stderr: string;
  stdoutSha256: string;
  stderrSha256: string;
}
export const evidenceSha256 = "cdee2e3a38d929e66d8fdf3917bed62ea46ccff86091de0816128c38176bd8d3";
const bytes = readFileSync(new URL("./native.json", import.meta.url));
assert.equal(createHash("sha256").update(bytes).digest("hex"), evidenceSha256, "independent frozen evidence changed");
export const evidence = JSON.parse(bytes.toString("utf8")) as { version: string; cases: NativeCase[] };
assert.equal(evidence.cases.length, 69);
for (const fixture of evidence.cases) {
  assert.equal(createHash("sha256").update(fixture.stdout).digest("hex"), fixture.stdoutSha256);
  assert.equal(createHash("sha256").update(fixture.stderr).digest("hex"), fixture.stderrSha256);
}
