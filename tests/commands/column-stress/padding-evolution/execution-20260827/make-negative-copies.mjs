import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [candidate, scratch] = process.argv.slice(2);
const source = await readFile(join(candidate, "dist/commands/column/table.js"), "utf8");
const marker = "    if (!rows.length)";
assert.equal(source.split(marker).length, 2);
const probe = "    globalThis.__columnWidthReads = 0;\n    widths = new Proxy(widths, { get(target, key) { if (typeof key === 'string' && /^[0-9]+$/.test(key) && ++globalThis.__columnWidthReads > 1000000) throw new Error('Independent uncharged-width traversal guard'); return Reflect.get(target, key); } });\n";
const variants = [
  ["rectangle-mutant", "    const forbiddenRectangle = rows.map(() => Array.from(widths));\n    if (!forbiddenRectangle.length) throw new Error('Empty mutation');\n"],
  ["scan-probe-reference", probe],
  ["scan-mutant", probe + "    for (const row of rows) for (let index = 0; index < widths.length; index++) { const uncharged = widths[index]; if (uncharged < 0) throw new Error('Negative width'); }\n"],
];
const records = [];
for (const [name, insertion] of variants) {
  const root = join(scratch, name); await mkdir(root);
  await cp(join(candidate, "dist"), join(root, "dist"), { recursive: true, errorOnExist: true, force: false });
  await cp(join(candidate, "package.json"), join(root, "package.json"), { errorOnExist: true, force: false });
  const path = join(root, "dist/commands/column/table.js");
  const patch = `*** Begin Patch\n*** Update File: ${path}\n@@\n-${marker}\n+${insertion.trimEnd().split("\n").join("\n+")}\n+${marker}\n*** End Patch\n`;
  const result = spawnSync("apply_patch", [], { input: patch, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  records.push({ name, root, classification: name === "scan-probe-reference" ? "instrumented-reference-sidecar-not-candidate-acceptance" : "deliberately-faulty-negative-only-not-candidate", changedFile: "dist/commands/column/table.js", insertion, originalSha256: createHash("sha256").update(source).digest("hex"), changedSha256: createHash("sha256").update(await readFile(path)).digest("hex") });
}
await writeFile(join(scratch, "negative-copy-provenance.json"), JSON.stringify(records, null, 2) + "\n", { flag: "wx" });
