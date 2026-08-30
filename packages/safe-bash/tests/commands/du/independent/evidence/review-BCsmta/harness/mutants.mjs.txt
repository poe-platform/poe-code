import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyMutants({ candidate, directory, work, output, root, execute }) {
  const variants = [
    { name: "size-fallback", file: "du.ts", before: ': stat.allocatedBytes;', after: ': (stat.allocatedBytes ?? stat.size);' },
    { name: "zero-omit", file: "du.ts", before: 'if (!amount.complete) return;', after: 'if (!amount.complete || amount.bytes === 0) return;' },
    { name: "false-identity", file: "du.ts", before: 'const { identityScope: scope, dev, ino } = stat;', after: 'const { dev, ino } = stat;\n    const scope = Symbol.for("independent-mutant-shared");' },
    { name: "overflow", file: "du.ts", before: 'if (right.bytes > Number.MAX_SAFE_INTEGER - left.bytes) {', after: 'if (false) {' },
    { name: "incomplete-total", file: "du.ts", before: 'if (!amount.complete) return;', after: 'if (false) return;' },
    { name: "output-quota", file: "budget.ts", before: '    this.check(text.length, this.limits.maxOutputBytes - this.output, "output");\n    const size = Buffer.byteLength(text);\n    this.check(size, this.limits.maxOutputBytes - this.output, "output");', after: '    this.check(text.length, Number.MAX_SAFE_INTEGER, "output");\n    const size = Buffer.byteLength(text);\n    this.check(size, Number.MAX_SAFE_INTEGER, "output");' },
  ];
  const results = [];
  for (const variant of variants) {
    const baseline = await execute(`mutant-${variant.name}-baseline`, process.execPath, [join(directory, "mutant-check.mjs"), join(candidate, "dist"), variant.name]);
    assert.equal(baseline.status, 0, `baseline assertion failed: ${variant.name}`);
    const mutant = join(work, "mutants", variant.name);
    await mkdir(join(mutant, "tests/commands/du"), { recursive: true });
    await cp(join(candidate, "src"), join(mutant, "src"), { recursive: true });
    for (const file of ["package.json", "tsconfig.json"]) await copyFile(join(candidate, file), join(mutant, file));
    await copyFile(join(candidate, "tests/commands/du/tsconfig.build.json"), join(mutant, "tests/commands/du/tsconfig.build.json"));
    await symlink(join(root, "node_modules"), join(mutant, "node_modules"));
    const path = `src/commands/du/${variant.file}`;
    const source = await readFile(join(mutant, path), "utf8");
    assert.equal(source.split(variant.before).length, 2, `mutant target must be unique: ${variant.name}`);
    const lines = source.split("\n");
    const start = lines.findIndex(line => line.includes(variant.before.split("\n")[0]));
    const count = variant.before.split("\n").length;
    const oldLines = lines.slice(start, start + count);
    const newLines = oldLines.join("\n").replace(variant.before, variant.after).split("\n");
    const patch = `*** Begin Patch\n*** Update File: ${path}\n@@\n${oldLines.map(line => `-${line}`).join("\n")}\n${newLines.map(line => `+${line}`).join("\n")}\n*** End Patch`;
    await writeFile(join(output, `mutant-${variant.name}.patch.txt`), patch + "\n");
    const applied = await execute(`mutant-${variant.name}-apply`, "apply_patch", [patch], mutant);
    assert.equal(applied.status, 0);
    const actual = await readFile(join(mutant, path), "utf8");
    assert.equal(actual, source.replace(variant.before, variant.after));
    const built = await execute(`mutant-${variant.name}-build`, join(root, "node_modules/.bin/tsc"), ["-p", "tests/commands/du/tsconfig.build.json", "--outDir", "dist"], mutant);
    assert.equal(built.status, 0, `invalid mutation, not a kill: ${variant.name}`);
    const tested = await execute(`mutant-${variant.name}-test`, process.execPath, [join(directory, "mutant-check.mjs"), join(mutant, "dist"), variant.name], mutant);
    const killed = tested.status === 1 && tested.stderr.includes("AssertionError");
    results.push({ ...variant, baselineStatus: baseline.status, buildStatus: built.status, testStatus: tested.status, killed, sourceSha256: createHash("sha256").update(actual).digest("hex"), builtSha256: createHash("sha256").update(await readFile(join(mutant, "dist/commands/du", variant.file.replace(".ts", ".js")))).digest("hex") });
    await writeFile(join(output, "mutants.json"), JSON.stringify(results, null, 2) + "\n");
    assert.equal(killed, true, `mutant survived: ${variant.name}`);
  }
}
