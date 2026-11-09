import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, parseMpegTs, serializeMpegTs } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/mpegts-aac-pes.mp4", import.meta.url));
// FFmpeg 7.0.2: -i input.mp4 -map 0:a -c copy [-pes_payload_size 500|8000] out.ts.
const native = JSON.parse(readFileSync(new URL("./fixtures/mpegts-aac-pes.json", import.meta.url), "utf8")) as
  Record<string, { pts: number[]; size: number; hash: string }>;
const parsed = parseMp4(input, { decodeAudio: false });
const audio = { ...parsed, tracks: parsed.tracks.filter(track => track.type === "audio") };

function inspect(bytes: Uint8Array) {
  const pts: number[] = [];
  const groups: Buffer[] = [];
  const lengths: number[] = [];
  let cc: number | undefined;
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const p = Buffer.from(bytes.subarray(offset, offset + 188));
    assert.equal(p.length, 188);
    assert.equal(p[0], 0x47);
    if ((p.readUInt16BE(1) & 8191) !== 256) continue;
    const adaptation = p[3]! >> 4 & 3;
    if (!(adaptation & 1)) continue;
    if (cc !== undefined) assert.equal(p[3]! & 15, (cc + 1) & 15);
    cc = p[3]! & 15;
    let pos = 4 + ((adaptation & 2) ? 1 + p[4]! : 0);
    if (p[1]! & 64) {
      assert.equal(p.readUIntBE(pos, 4), 0x1c0);
      lengths.push(p.readUInt16BE(pos + 4) - 3 - p[pos + 8]!);
      const t = p.subarray(pos + 9);
      pts.push((t[0]! & 14) * 536870912 + t[1]! * 4194304 +
        (t[2]! & 254) * 16384 + t[3]! * 128 + (t[4]! >> 1));
      groups.push(Buffer.alloc(0));
      pos += 9 + p[pos + 8]!;
    }
    groups[groups.length - 1] = Buffer.concat([groups.at(-1)!, p.subarray(pos)]);
  }
  assert.deepEqual(groups.map(group => group.length), lengths);
  const payload = Buffer.concat(groups);
  return { pts, size: payload.length, hash: createHash("sha256").update(payload).digest("hex") };
}

async function run(volume: InstanceType<typeof Volume>, args: string[], sync: boolean, success = true) {
  if (sync) {
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), success ? "" : undefined);
    return;
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode === 0, success, stderr);
  if (!success) assert.ok(stderr.includes("pes_payload_size"), stderr);
}

for (const [key, value, muxDelay] of [
  ["audio", undefined], ["small", "500"], ["large", "8000"],
  ["zero", "0"], ["one", "1"], ["boundary", "170"], ["rounded", "171"],
  ["noDelay", "8000", 0], ["shortDelay", "8000", 0.04]
] as const) {
  for (const sync of [false, true]) {
    it(`groups AAC into native ${key} PES payloads (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/input.mp4": input });
      await run(volume, ["-y", "-i", "/input.mp4", ...(sync ? ["-vn"] : ["-map", "0:a"]), "-c", "copy",
        ...(value === undefined ? [] : ["-pes_payload_size", value]),
        ...(muxDelay === undefined ? [] : ["-muxdelay", String(muxDelay)]), "/out.ts"], sync);
      const output = volume.readFileSync("/out.ts") as Buffer;
      const expected = native[key]!;
      assert.deepEqual(inspect(output), { pts: expected.pts, size: expected.size, hash: expected.hash });
      assert.deepEqual(parseMpegTs(output).tracks[0]!.samples.map(sample => Buffer.from(sample.data)),
        audio.tracks[0]!.samples.map(sample => Buffer.from(sample.data)));
    });
  }
  it(`exposes ${key} PES grouping through the serializer`, () => {
    const expected = native[key]!;
    const output = serializeMpegTs(audio, { pesPayloadSize: value === undefined ? undefined : Number(value), muxDelay });
    assert.deepEqual(inspect(output), { pts: expected.pts, size: expected.size, hash: expected.hash });
  });
}

for (const sync of [false, true]) {
  for (const value of ["-1", "1.5", "2147483648", "NaN", "Infinity", "bad", ""]) {
    it(`rejects invalid PES payload size ${JSON.stringify(value)} without overwriting output (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/input.mp4": input, "/out.ts": "KEEP" });
      await run(volume, ["-y", "-i", "/input.mp4", "-vn", "-c", "copy", "-pes_payload_size", value, "/out.ts"], sync, false);
      assert.equal(volume.readFileSync("/out.ts", "utf8"), "KEEP");
    });
  }
}

it("scopes pes_payload_size to each command output", async () => {
  const volume = Volume.fromJSON({ "/input.mp4": input });
  await run(volume, ["-y", "-i", "/input.mp4", "-vn", "-c", "copy", "-pes_payload_size", "500", "/small.ts",
    "-vn", "-c", "copy", "/default.ts"], false);
  assert.deepEqual(inspect(volume.readFileSync("/small.ts") as Buffer).pts, native.small!.pts);
  assert.deepEqual(inspect(volume.readFileSync("/default.ts") as Buffer).pts, native.audio!.pts);
});

it("validates SDK payload sizes and bounds allocation by actual audio bytes", () => {
  for (const pesPayloadSize of [-1, 1.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => serializeMpegTs(audio, { pesPayloadSize }), /pes_payload_size/);
  }
  assert.equal(inspect(serializeMpegTs(audio, { pesPayloadSize: 2147483647, limits: { maxMemoryBytes: 1000000 } })).hash, native.audio!.hash);
});
