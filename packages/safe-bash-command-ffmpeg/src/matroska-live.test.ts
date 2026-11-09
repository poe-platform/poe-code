import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv, serializeMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native VP8 fixture: four packets at 0, 0.5, 1 and 1.5 seconds.
const input = readFileSync(new URL("./fixtures/matroska-live.webm", import.meta.url));
const packets = (bytes: Uint8Array) => parseMkv(bytes).tracks.flatMap(track =>
  track.samples.map(sample => ({ pts: sample.pts / track.timescale, data: sample.data })));
const expected = packets(new Uint8Array(input));
assert.deepEqual(expected.map(packet => packet.pts), [0, 0.5, 1, 1.5]);

// Walk EBML boundaries independently of the production parser, including size VINTs.
function elements(bytes: Uint8Array, start = 0, end = bytes.length) {
  const result: { id: number; data: number; end: number; unknown: boolean }[] = [];
  while (start < end) {
    const read = (size: boolean) => {
      const first = bytes[start++]!;
      let marker = 0x80;
      let length = 1;
      while (!(first & marker) && length < 8) { marker >>= 1; length++; }
      assert.ok(marker && first & marker);
      let value = size ? first & (marker - 1) : first;
      let unknown = size && value === marker - 1;
      for (let i = 1; i < length; i++) {
        const byte = bytes[start++]!;
        unknown &&= byte === 0xff;
        value = value * 256 + byte;
      }
      return { value, unknown };
    };
    const id = read(false).value;
    const size = read(true);
    const next = size.unknown ? end : start + size.value;
    assert.ok(start <= next && next <= end);
    result.push({ id, data: start, end: next, unknown: size.unknown });
    start = next;
  }
  return result;
}

function checkOutput(bytes: Uint8Array, live: boolean) {
  const segment = elements(bytes).find(element => element.id === 0x18538067)!;
  assert.ok(segment);
  assert.equal(segment.unknown, live, "Segment size");
  const children = elements(bytes, segment.data, segment.end);
  const info = children.find(element => element.id === 0x1549a966)!;
  assert.ok(info);
  assert.equal(elements(bytes, info.data, info.end).some(element => element.id === 0x4489), !live, "Info/Duration");
  assert.equal(children.some(element => element.id === 0x1c53bb6b), !live, "Cues");
  assert.deepEqual(packets(new Uint8Array(bytes)), expected);
}

async function run(sync: boolean, extra: string[]) {
  const volume = Volume.fromJSON({ "/in.webm": input, "/out.mkv": "existing output" });
  const args = ["-v", "error", "-y", "-i", "/in.webm", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy", ...extra];
  let success: boolean;
  if (sync) {
    success = evalSyncFfmpeg(args, undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }) === "";
  } else {
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    success = result.exitCode === 0;
  }
  return { volume, success };
}

for (const live of [undefined, false, true]) {
  it(`serializes Matroska live=${live} through the media API`, () => {
    checkOutput(serializeMkv(parseMkv(new Uint8Array(input)), { live }), live === true);
  });
}

for (const sync of [false, true]) {
  for (const extension of ["mkv", "webm"]) {
    for (const live of [undefined, "0", "1"]) {
      it(`${sync ? "sync" : "async"} copies packets to local ${extension} with live=${live}`, async () => {
        const { volume, success } = await run(sync, [...(live === undefined ? [] : ["-live", live]), `/out.${extension}`]);
        assert.equal(success, true);
        checkOutput(volume.readFileSync(`/out.${extension}`) as Buffer, live === "1");
      });
    }
  }
  for (const value of ["2", "-1", "invalid"]) {
    it(`rejects invalid live=${value} without replacing output (${sync ? "sync" : "async"})`, async () => {
      const { volume, success } = await run(sync, ["-live", value, "/out.mkv"]);
      assert.equal(success, false);
      assert.equal(volume.readFileSync("/out.mkv", "utf8"), "existing output");
    });
  }
}

it("resets live mode for each output", async () => {
  const { volume, success } = await run(false, ["-live", "1", "/out.mkv", "-c", "copy", "/second.mkv"]);
  assert.equal(success, true);
  checkOutput(volume.readFileSync("/out.mkv") as Buffer, true);
  checkOutput(volume.readFileSync("/second.mkv") as Buffer, false);
});
