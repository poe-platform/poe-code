import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export function resolutionLines(lines, consumer) {
  assert.ok(lines.length <= 3);
  const expected = [
    `======== Module name 'virtual-bash' was successfully resolved to '${consumer}/node_modules/virtual-bash/dist/index.d.ts' with Package ID 'virtual-bash/dist/index.d.ts@0.0.0'. ========`,
    `======== Module name 'virtual-bash/commands/expr' was successfully resolved to '${consumer}/node_modules/virtual-bash/dist/commands/expr/index.d.ts' with Package ID 'virtual-bash/dist/commands/expr/index.d.ts@0.0.0'. ========`,
  ];
  assert.deepEqual(lines, expected, "exact public root/leaf successful resolution required");
  return lines;
}
export async function extractResolutions(path, consumer) {
  const selected = [];
  let bytes = 0, count = 0;
  const lines = createInterface({ input: createReadStream(path, { highWaterMark: 65536 }), crlfDelay: Infinity });
  for await (const line of lines) {
    bytes += Buffer.byteLength(line) + 1; count++;
    assert.ok(bytes <= 67108864 && Buffer.byteLength(line) <= 131072 && count <= 2000000);
    assert.ok(!(line.includes("successfully resolved") && line.includes("/src/")));
    if (/Module name 'virtual-bash(?:\/commands\/expr)?' was successfully resolved/u.test(line)) { selected.push(line); assert.ok(selected.length <= 2); }
  }
  return resolutionLines(selected, consumer);
}
export function qualifyResolutions(source) {
  const positive = source.resolutions, consumer = source.receipt.cwd;
  resolutionLines(positive, consumer);
  const mutations = [
    ["wrong-root", lines => { lines[0] = lines[0].replace("dist/index.d.ts", "dist/other.d.ts"); }],
    ["wrong-leaf", lines => { lines[1] = lines[1].replace("dist/commands/expr/index.d.ts", "src/commands/expr/index.ts"); }],
    ["missing-leaf", lines => { lines.pop(); }],
    ["path-mention-not-resolution", lines => { lines[0] = lines[0].replace("was successfully resolved", "was not resolved"); }],
    ["duplicate-root", lines => { lines.push(lines[0]); }],
  ];
  const controls = [{ id: "resolution-authenticated-positive", status: "pass", kind: "authenticated-prior-lines-validator-control" }];
  for (const [id, mutate] of mutations) { const lines = [...positive]; mutate(lines); assert.throws(() => resolutionLines(lines, consumer)); controls.push({ id: `resolution-${id}`, status: "pass", kind: "harness-negative-resolution-mutation" }); }
  return controls;
}
