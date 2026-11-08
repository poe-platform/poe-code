import assert from "node:assert/strict";
import { it } from "node:test";
import { readFile } from "node:fs/promises";
import { Volume } from "memfs";
import { parseMp4, scanMp4Packets } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native fixtures: testsrc2=size=64x48:rate=5:duration=2, libx264 -g 5
// -keyint_min 5 -sc_threshold 0 -bf 0; b adds -vf negate. trimmed is
// the first clip remuxed with -ss 0.6 -c copy. Native ffprobe confirms
// first PTS -0.6 / second clip 1.4, or 0 / 2 with ignore_editlist=1.
async function run(directives: string, safe = "0", second = "b") {
  const files = await Promise.all(["trimmed", "b"].map(name =>
    readFile(new URL(`./fixtures/concat-options/${name}.mp4`, import.meta.url))));
  const volume = Volume.fromJSON({
    "/trimmed.mp4": files[0]!, "/b.mp4": files[1]!,
    "/list.ffconcat": `ffconcat version 1.0\nfile trimmed.mp4\n${directives}file ${second}.mp4\n`
  });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-f", "concat", "-safe", safe, "-i", "/list.ffconcat", "-c", "copy", "/out.mp4"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume, files };
}

async function packetsFrom(volume: Volume) {
  const bytes = volume.readFileSync("/out.mp4") as Buffer;
  const packets = [];
  for await (const packet of scanMp4Packets({ size: bytes.length,
    async read(offset: number, length: number) { return bytes.subarray(offset, offset + length); }
  }, { syncSamples() {
    const keys = new Set<number>();
    return { add(index: number) { keys.add(index); }, has(index: number) { return keys.has(index); } };
  } })) packets.push(packet);
  return packets;
}

for (const value of [undefined, "0", "1", "'1'"]) {
  it(`concat applies per-file ignore_editlist=${value} to packet timing and payloads`, async () => {
    const { result, stderr, volume, files } = await run(value === undefined ? "" : `option ignore_editlist ${value}\n`);
    assert.equal(result.exitCode, 0, stderr);
    const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
    const packets = await packetsFrom(volume);
    const enabled = value === "1" || value === "'1'";
    assert.deepEqual(packets.map(packet => Number(packet.pts_time)),
      Array.from({ length: 20 }, (_, i) => Number((i / 5 - (enabled ? 0 : 0.6)).toFixed(6))));
    const slices = (data: Uint8Array) => {
      const result: Buffer[] = [];
      for (let offset = 0; offset < data.length;) {
        const length = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0);
        offset += 4;
        if ([1, 5].includes(data[offset]! & 31)) result.push(Buffer.from(data.subarray(offset, offset + length)));
        offset += length;
      }
      return result;
    };
    assert.deepEqual(output.tracks[0]!.samples.map(sample => slices(sample.data)),
      files.flatMap(file => parseMp4(file).tracks[0]!.samples.map(sample => slices(sample.data))));
  });
}

it("concat options do not leak to the next file", async () => {
  const { result, stderr, volume } = await run("option ignore_editlist 1\n", "0", "trimmed");
  assert.equal(result.exitCode, 0, stderr);
  const packets = await packetsFrom(volume);
  // Overlapping preroll packets are repaired to monotonic DTS by the muxer.
  assert.ok(Number(packets[10]!.pts_time) < 1.801);
  assert.equal(Number(packets[13]!.pts_time), 2);
});

it("concat rejects per-file options in safe mode", async () => {
  const { result, stderr, volume } = await run("option ignore_editlist 1\n", "1");
  assert.notEqual(result.exitCode, 0);
  assert.ok(stderr.includes("option not allowed if safe"), stderr);
  assert.equal(volume.existsSync("/out.mp4"), false);
});

it("concat permits timing directives around options and uses the last option value", async () => {
  const { result, stderr, volume } = await run("duration 3\noption ignore_editlist 0\n# comment\noption 'ignore_editlist' 1\noutpoint 2\n");
  assert.equal(result.exitCode, 0, stderr);
  const packets = await packetsFrom(volume);
  assert.equal(Number(packets[0]!.pts_time), 0);
  assert.equal(Number(packets[10]!.pts_time), 3);
});

for (const directive of ["option", "option ignore_editlist", "option ignore_editlist invalid"]) {
  it(`concat rejects malformed directive: ${directive}`, async () => {
    const { result, volume } = await run(`${directive}\n`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.existsSync("/out.mp4"), false);
  });
}
