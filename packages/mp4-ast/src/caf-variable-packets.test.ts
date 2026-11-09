import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { cafAst } from "./containers/caf.js";
import { rawAudioAsts } from "./containers/raw-audio.js";

const varyboth = readFileSync(new URL("./fixtures/varyboth.caf", import.meta.url));
const widevar = readFileSync(new URL("./fixtures/widevar.caf", import.meta.url));
const missingTable = readFileSync(new URL("./fixtures/no-var-table.caf", import.meta.url));

// Independently packed CAF bytes and native FFmpeg packet/sample results.
for (const [name, input, values, packets] of [
  ["varyboth", varyboth, [101, 102, 103, 104, 105, 106, 107, 108], [
    { pts: 0, duration: 2, size: "4", pos: "110" },
    { pts: 2, duration: 1, size: "2", pos: "114" },
    { pts: 3, duration: 5, size: "10", pos: "116" }
  ]],
  ["widevar", widevar, Array.from({ length: 68 }, (_, i) => i), [
    { pts: 0, duration: 64, size: "128", pos: "109" },
    { pts: 64, duration: 4, size: "8", pos: "237" }
  ]]
] as const) {
  it(`decodes, copies and probes variable CAF packets in ${name}`, () => {
    const ast = cafAst();
    const doc = ast.parse(input);
    assert.deepEqual(Array.from(doc.tracks[0]!.decodedAudio!.channelData[0]!, value => value * 32768), values);
    const probe = ast.probe(input, { showPackets: true });
    assert.equal(probe.streams[0]!.duration_ts, values.length);
    assert.equal(probe.streams[0]!.nb_frames, String(values.length));
    assert.deepEqual(probe.packets!.map(({ pts, duration, size, pos }) => ({ pts, duration, size, pos })), packets);
    const copied = ast.parse(input, { decodeAudio: false });
    assert.equal(copied.tracks[0]!.decodedAudio, undefined);
    assert.deepEqual(rawAudioAsts().find(plugin => plugin.id === "s16be")!.serialize(copied, { audioCodec: "copy" }),
      new Uint8Array(input.subarray(Number(packets[0].pos))));
    assert.throws(() => ast.parse(input, { limits: { maxSamplesPerTrack: packets.length - 1 } }), /limit/i);
    assert.throws(() => ast.parse(input, { limits: { maxDurationSeconds: (values.length - 1) / 8000 } }), /limit/i);
    assert.throws(() => ast.parse(input, { limits: { maxMemoryBytes: 1 } }), /memory/i);
  });
}

for (const variable of ["bytes", "frames"] as const) {
  it(`reads only the variable ${variable} field from the CAF packet table`, () => {
    const input = Buffer.concat([varyboth.subarray(0, 88), Buffer.alloc(4, variable === "bytes" ? 4 : 2), varyboth.subarray(94)]);
    input.writeUInt32BE(variable === "bytes" ? 0 : 4, 36);
    input.writeUInt32BE(variable === "frames" ? 0 : 2, 40);
    input.writeBigInt64BE(28n, 56);
    input.writeBigInt64BE(4n, 64);
    const doc = cafAst().parse(input);
    assert.deepEqual(doc.tracks[0]!.samples.map(({ size, duration, pts }) => ({ size, duration, pts })),
      Array.from({ length: 4 }, (_, i) => ({ size: 4, duration: 2, pts: i * 2 })));
  });
}

it("rejects missing, truncated, overflowing and inconsistent CAF packet tables", () => {
  assert.throws(() => cafAst().parse(missingTable), /packet table/);
  const mutations = [
    (b: Buffer) => b.writeBigInt64BE(-1n, 64),
    (b: Buffer) => b.writeBigInt64BE(1n << 53n, 64),
    (b: Buffer) => b.writeBigInt64BE(4n, 64),
    (b: Buffer) => b.writeBigInt64BE(2n, 64),
    (b: Buffer) => b.fill(255, 88, 94),
    (b: Buffer) => b.writeUInt8(128, 93),
    (b: Buffer) => b.writeUInt8(0, 88),
    (b: Buffer) => b.writeUInt8(0, 89),
    (b: Buffer) => b.writeUInt8(3, 88),
    (b: Buffer) => b.writeUInt8(12, 92)
  ];
  for (const mutate of mutations) {
    const input = Buffer.from(varyboth);
    mutate(input);
    assert.throws(() => cafAst().parse(input, { decodeAudio: false }), /CAF packet/);
  }
});

for (const afterData of [false, true]) {
  it(`reads multi-byte CAF frame counts with pakt ${afterData ? "after" : "before"} data`, () => {
    const description = varyboth.subarray(0, 52);
    const table = Buffer.concat([varyboth.subarray(52, 88), Buffer.from([0x82, 0, 0x81, 0])]);
    table.writeBigInt64BE(28n, 4);
    table.writeBigInt64BE(1n, 12);
    table.writeBigInt64BE(128n, 20);
    const data = Buffer.concat([varyboth.subarray(94, 110), Buffer.alloc(256)]);
    data.writeBigInt64BE(260n, 4);
    const input = Buffer.concat([description, ...(afterData ? [data, table] : [table, data])]);
    const doc = cafAst().parse(input);
    assert.equal(doc.duration, 128);
    assert.equal(doc.tracks[0]!.decodedAudio!.channelData[0]!.length, 128);
    assert.equal(doc.tracks[0]!.samples[0]!.offset, afterData ? 68 : 108);
    assert.equal(doc.tracks[0]!.samples[0]!.duration, 128);
  });
}

it("rejects CAF packet integers beyond safe integer precision", () => {
  const table = Buffer.concat([varyboth.subarray(52, 88), Buffer.alloc(8, 255), Buffer.from([0])]);
  table.writeBigInt64BE(33n, 4);
  table.writeBigInt64BE(1n, 12);
  const input = Buffer.concat([varyboth.subarray(0, 52), table, varyboth.subarray(94)]);
  assert.throws(() => cafAst().parse(input), /CAF packet integer/);
});
