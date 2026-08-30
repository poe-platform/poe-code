import assert from "node:assert/strict";
import { join } from "node:path";
import { directory, repository, owner, oldDirectory, legacyDirectory, candidate, read, json, digest, putJson } from "./common.mjs";
import { git, inputs, bindAcceptedProof } from "../component-execution-v5/auth.mjs";

const manifest = json(join(oldDirectory, "MANIFEST.json"));
assert.equal(digest(read(join(oldDirectory, "MANIFEST.json"))), "b8605b3dfe7d35723d6d24627a797edb0a60165e614c5800e54ffba4e0ff08f1");
assert.equal(digest(read(join(oldDirectory, "EVIDENCE-SEAL.json"))), "0a37b5795ac594f1a1e587786295bb0dd21019162b3c76cfff3607fec6c232b1");
function raw(name) {
  const row = manifest.entries.find(value => value.path === name); assert.ok(row, name);
  const bytes = read(join(oldDirectory, "work/run-001/raw", name));
  assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256);
  return bytes;
}
const fullMessage = "Object literal may only specify known properties, but 'maxRegexSteps' does not exist in type 'Partial<ExprLimits>'. Did you mean to write 'maxRegexStates'?";
const rows = [];
const negative = read(join(legacyDirectory, "negative.ts.fixture")).toString();
for (const layout of ["installed-node22", "installed-node24", "moved-node22", "moved-node24"]) {
  const trace = JSON.parse(raw(`${layout}-type-positive.json`));
  const traceBytes = raw(`${layout}-type-positive.stdout.raw`);
  assert.equal(trace.status, 0); assert.equal(trace.naturalSettlement, true); assert.equal(trace.closed, true);
  assert.equal(raw(`${layout}-type-positive.stderr.raw`).length, 0);
  const resolutions = traceBytes.toString().split("\n").filter(line => /Module name 'virtual-bash(?:\/commands\/expr)?' was successfully resolved/u.test(line));
  const declarationPaths = ["dist/index.d.ts", "dist/commands/expr/index.d.ts"];
  assert.equal(resolutions.length, 2);
  for (const [index, suffix] of declarationPaths.entries()) assert.ok(resolutions[index].includes(`'${trace.cwd}/node_modules/virtual-bash/${suffix}'`));
  const before = JSON.parse(raw(`${layout}-type-positive-input-before.json`));
  const declarations = declarationPaths.map(suffix => {
    const row = before.find(value => value.path === `node_modules/virtual-bash/${suffix}`);
    assert.equal(row.sha256, inputs.packageFiles[suffix]); return row;
  });
  for (const id of ["N04", "combined"]) {
    const receipt = JSON.parse(raw(`${layout}-type-${id}.json`));
    const stdout = raw(`${layout}-type-${id}.stdout.raw`).toString(), stderr = raw(`${layout}-type-${id}.stderr.raw`).toString();
    assert.equal(receipt.status, 2); assert.equal(receipt.naturalSettlement, true); assert.equal(receipt.closed, true);
    assert.equal(stderr, ""); assert.equal(receipt.args.includes("--traceResolution"), false);
    const diagnostics = stdout.trimEnd().split("\n");
    const expected = id === "N04" ? [[11, "TS2561"]] : [[5, "TS2353"], [7, "TS2353"], [9, "TS2322"], [11, "TS2561"], [13, "TS2322"], [15, "TS2322"]];
    assert.deepEqual(diagnostics.map(line => { const match = /^([^()]+)\((\d+),\d+\): error (TS\d+): /u.exec(line); assert.ok(match); assert.equal(match[1], `${layout}-${id}.ts`); return [Number(match[2]), match[3]]; }), expected);
    assert.equal(diagnostics.find(line => line.includes("(11,")), `${layout}-${id}.ts(11,32): error TS2561: ${fullMessage}`);
    const input = id === "N04" ? negative.replace(/\/\/ @ts-expect-error N04[^\n]*/u, "") : negative.replace(/\/\/ @ts-expect-error[^\n]*/gu, "");
    const inputRow = JSON.parse(raw(`${layout}-type-${id}-input-before.json`)).find(value => value.path === `${layout}-${id}.ts`);
    assert.equal(inputRow.sha256, digest(input));
    rows.push({ layout, id, receipt, stdout, stderr, diagnostics, inputSha256: digest(input), resolutions, declarations,
      rawBindings: [`${layout}-type-${id}.json`, `${layout}-type-${id}.stdout.raw`, `${layout}-type-${id}.stderr.raw`, `${layout}-type-${id}-input-before.json`, `${layout}-type-positive.json`, `${layout}-type-positive.stdout.raw`, `${layout}-type-positive-input-before.json`].map(name => manifest.entries.find(value => value.path === name)) });
  }
}
const cases = read(join(legacyDirectory, "cases.json"));
assert.equal(digest(cases), "215f5e8f44ccf8792cfc175437fe9701fa7f176d29081d5d561cd828f1269b16");
const original = JSON.parse(cases).runtimeCases.find(value => value.id === "R21");
assert.deepEqual([original.args, ...original.variants.map(value => value.args)], [["bad\0arg"], ["\ud800"]]);
const ranges = {
  "src/shell/runtime.ts": [[594, 611], [939, 956], [981, 995], [1545, 1605]],
  "src/commands/expr/index.ts": [[12, 26], [57, 79]],
  "src/commands/expr/internal.ts": [[1, 42], [72, 93]],
  "src/commands/expr/README.md": [[109, 119]],
};
const pathTrace = Object.entries(ranges).map(([path, spans]) => {
  const bytes = git("show", `${candidate}:${path}`), lines = bytes.toString().split("\n");
  const selected = inputs.selected.find(value => value.path === path); assert.ok(selected); assert.equal(digest(bytes), selected.sha256);
  return { path, sha256: digest(bytes), gitBlob: selected.gitBlob, excerpts: spans.map(([start, end]) => ({ start, end, lines: lines.slice(start - 1, end) })) };
});
const proof = bindAcceptedProof();
putJson(join(directory, "INSPECTION.json"), { schema: "expr-r21-n04-readonly/1", authorizationDate: "2026-08-28", candidate, originalR21: original, pathTrace, N04: { verified: true, fullMessage, rows }, P01: proof.P01, reader: proof.reader, repair: proof.repair,
  reusedV5: { commit: "7b68a7b2866217a21d52ff8b99dcab166f83f5ae", controls: 38, replayed: 0, manifestSha256: digest(read(join(oldDirectory, "MANIFEST.json"))) }, newProductInvocations: 0 });
console.log(JSON.stringify({ checkpoint: "read-only-inspection-frozen", N04Verified: rows.length, originalR21Inputs: 2, P01: proof.P01.status, pathTraceFiles: pathTrace.length, newProductInvocations: 0 }));
