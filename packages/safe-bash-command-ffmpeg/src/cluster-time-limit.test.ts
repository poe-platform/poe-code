import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv, serializeMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native VP8 WebM: eight packets at 2 fps, keyframes every second.
const input = readFileSync(new URL("../../mp4-ast/src/fixtures/mkv-keyframes.webm", import.meta.url));
const source = parseMkv(input);

function elements(bytes: Uint8Array, start = 0, end = bytes.length) {
  const result: { id: number; data: number; end: number }[] = [];
  const vint = (offset: number, size: boolean) => {
    let length = 1;
    while (length <= 8 && (bytes[offset]! & (0x80 >> (length - 1))) === 0) length++;
    assert.ok(length <= 8);
    let value = size ? bytes[offset]! & (0xff >> length) : bytes[offset]!;
    for (let index = 1; index < length; index++) value = value * 256 + bytes[offset + index]!;
    return { value, length };
  };
  while (start < end) {
    const id = vint(start, false);
    const size = vint(start + id.length, true);
    const data = start + id.length + size.length;
    const next = data + size.value;
    assert.ok(next <= end);
    result.push({ id: id.value, data, end: next });
    start = next;
  }
  return result;
}

function clusterPackets(bytes: Uint8Array) {
  const segment = elements(bytes).find(element => element.id === 0x18538067)!;
  return elements(bytes, segment.data, segment.end).filter(element => element.id === 0x1f43b675)
    .map(cluster => {
      const fields = elements(bytes, cluster.data, cluster.end);
      const time = fields.find(element => element.id === 0xe7)!;
      const timestamp = bytes.subarray(time.data, time.end).reduce((value, byte) => value * 256 + byte, 0);
      return fields.filter(element => element.id === 0xa3).map(block =>
        timestamp + new DataView(bytes.buffer, bytes.byteOffset + block.data).getInt16(1));
    });
}

function packets(bytes: Uint8Array) {
  return parseMkv(bytes).tracks[0]!.samples.map(({ pts, isKeyframe, data }) => ({ pts, isKeyframe, hash: createHash("sha256").update(data).digest("hex") }));
}

async function run(volume: Volume, output: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/clip.webm", "-map", "0:v", "-c", "copy", ...output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr };
}

// FFmpeg splits only when elapsed time exceeds the limit, including non-keyframes.
for (const [limit, expected] of [
  [undefined, [[0, 500, 1000, 1500, 2000, 2500, 3000, 3500]]],
  [-1, [[0, 500, 1000, 1500, 2000, 2500, 3000, 3500]]],
  [800, [[0, 500], [1000, 1500], [2000, 2500], [3000, 3500]]],
  [500, [[0, 500], [1000, 1500], [2000, 2500], [3000, 3500]]],
  [400, [[0], [500], [1000], [1500], [2000], [2500], [3000], [3500]]],
  [0, [[0], [500], [1000], [1500], [2000], [2500], [3000], [3500]]]
] as const) {
  for (const format of ["matroska", "webm"]) {
    it(`preserves every packet with ${format} cluster_time_limit=${limit}`, async () => {
      const volume = Volume.fromJSON({ "/clip.webm": input });
      const output = ["-f", format, ...(limit === undefined ? [] : ["-cluster_time_limit", String(limit)]), "/out.mkv"];
      const result = await run(volume, output);
      assert.equal(result.exitCode, 0, result.stderr);
      const bytes = volume.readFileSync("/out.mkv") as Buffer;
      assert.deepEqual(clusterPackets(bytes), expected);
      assert.deepEqual(packets(bytes), packets(input));
      const sdk = serializeMkv(source, { format, clusterTimeLimit: limit });
      assert.deepEqual(clusterPackets(sdk), expected);
      assert.deepEqual(packets(sdk), packets(input));
      assert.equal(evalSyncFfmpeg(["-y", "-i", "/clip.webm", "-c", "copy", ...output.slice(0, -1), "/sync.mkv"], undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      assert.deepEqual(clusterPackets(volume.readFileSync("/sync.mkv") as Buffer), expected);
      assert.deepEqual(packets(volume.readFileSync("/sync.mkv") as Buffer), packets(input));
    });
  }
}

it("scopes cluster time limits to each output", async () => {
  const volume = Volume.fromJSON({ "/clip.webm": input });
  const result = await run(volume, ["-cluster_time_limit", "800", "/four.mkv", "-c", "copy", "-cluster_time_limit", "400", "/eight.mkv", "-c", "copy", "/default.mkv"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(["four", "eight", "default"].map(name => clusterPackets(volume.readFileSync(`/${name}.mkv`) as Buffer).length), [4, 8, 1]);
});

for (const value of ["-2", "1.5", "bad", "", "9007199254740992"]) {
  it(`rejects invalid cluster_time_limit ${JSON.stringify(value)} before replacing output`, async () => {
    const volume = Volume.fromJSON({ "/clip.webm": input, "/out.mkv": "keep" });
    const result = await run(volume, ["-cluster_time_limit", value, "/out.mkv"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /cluster_time_limit/);
    assert.equal(volume.readFileSync("/out.mkv", "utf8"), "keep");
  });
}

it("uses a five-second default and keeps large limits within signed block timestamps", () => {
  const track = source.tracks[0]!;
  const doc = { ...source, tracks: [{ ...track, samples: track.samples.map((sample, index) => ({
    ...sample, pts: index * 5000, dts: index * 5000
  })) }] };
  for (const clusterTimeLimit of [undefined, -1]) {
    assert.deepEqual(clusterPackets(serializeMkv(doc, { clusterTimeLimit })), [[0, 5000], [10000, 15000], [20000, 25000], [30000, 35000]]);
  }
  const bytes = serializeMkv(doc, { clusterTimeLimit: 100000 });
  assert.deepEqual(clusterPackets(bytes), [[0, 5000, 10000, 15000, 20000, 25000, 30000], [35000]]);
  assert.deepEqual(parseMkv(bytes).tracks[0]!.samples.map(sample => sample.pts), doc.tracks[0]!.samples.map(sample => sample.pts));
});

it("rejects invalid SDK cluster time limits", () => {
  for (const clusterTimeLimit of [-2, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => serializeMkv(source, { clusterTimeLimit }), /cluster_time_limit/);
  }
});
