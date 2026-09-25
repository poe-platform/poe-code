import assert from "node:assert/strict";
import test from "node:test";
import { createCodec } from "../../../../src/commands/bytes/compression/codec-loader.js";
import type { RawCodecModule } from "../../../../src/commands/bytes/compression/native/types.js";
import xz from "../../../../src/commands/bytes/compression/native/generated/xz.mjs";
import zstd from "../../../../src/commands/bytes/compression/native/generated/zstd.mjs";

function moduleWithRequests(requests: (number | undefined)[][]): RawCodecModule {
  return {
    memory: { buffer: new ArrayBuffer(131072) },
    bridge_create(...args) { requests.push(args); return 0; },
    bridge_create_lzma(...args) { requests.push(args); return 0; },
    bridge_zstd_config() { return 0; },
    bridge_destroy() {}, bridge_step() { return 1; },
    bridge_input() { return 0; }, bridge_output() { return 65536; },
    bridge_consumed() { return 0; }, bridge_produced() { return 0; },
    bridge_used() { return 0; }, bridge_peak() { return 0; },
  };
}

for (const format of ["bzip2", "xz", "zstd"] as const) test(`${format} omitted native allocation quota reaches the bridge as unlimited`, async () => {
  const requests: (number | undefined)[][] = [];
  const codec = await createCodec({ format, level: 1, decompress: true }, new AbortController().signal, () => moduleWithRequests(requests));
  try { assert.equal(requests[0]![2], 0); assert.equal(requests[0]![7], 0); }
  finally { codec.close(); }
});

for (const memory of [0, 128 * 1024 ** 2, 8 * 1024 ** 3]) test(`XZ explicit memory ${memory} has no implicit ceiling`, async () => {
  const requests: (number | undefined)[][] = [];
  const codec = await createCodec({ format: "xz", level: 1, decompress: true, xzDecompressMemory: memory }, new AbortController().signal, () => moduleWithRequests(requests));
  try { assert.equal(requests[0]![2], memory >>> 0); assert.equal(requests[0]![7], Math.floor(memory / 0x100000000)); }
  finally { codec.close(); }
});

test("native Zstandard configuration admits representable long-distance windows", () => {
  const module = zstd({ fd_prestat_get: () => 8 });
  module._initialize?.();
  try {
    assert.equal(module.bridge_create(0, 1, 0, 30, 0, 0, 0, 0), 0);
    assert.equal(module.bridge_zstd_config!(1, 0, 0, 27, 0, 0, 0, 0), 0);
  } finally { module.bridge_destroy(); }
  assert.equal(module.bridge_used(), 0);
});

test("native LZMA honors explicit memory above 64 MiB and rejects a smaller individual quota", () => {
  const module = xz({ fd_prestat_get: () => 8 });
  module._initialize?.();
  const dictionary = 64 * 1024 ** 2 + 1;
  try {
    assert.equal(module.bridge_create_lzma!(1, 1, 1024, dictionary, 93, 1, 1, 0, 0), -2);
    assert.equal(module.bridge_peak(), 0);
    assert.equal(module.bridge_create_lzma!(1, 1, 128 * 1024 ** 2, dictionary, 93, 1, 1, 0, 0), 0);
    assert.ok(module.bridge_peak() > 64 * 1024 ** 2);
  } finally { module.bridge_destroy(); }
  assert.equal(module.bridge_used(), 0);
});
