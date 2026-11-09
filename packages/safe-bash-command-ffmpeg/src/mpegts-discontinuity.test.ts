import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, parseMpegTs, serializeMpegTs, createSyntheticMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/mpegts-discontinuity.mp4", import.meta.url));

function inspect(bytes: Uint8Array, enabled: boolean) {
  const counters = new Map<number, number>();
  const payloads = new Map<number, number[]>();
  const randomAccess = new Map<number, boolean[]>();
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = bytes.subarray(offset, offset + 188);
    assert.equal(packet.length, 188);
    assert.equal(packet[0], 0x47);
    const pid = ((packet[1]! & 31) << 8) | packet[2]!;
    const flags = (packet[3]! & 32) && packet[4] ? packet[5]! : 0;
    assert.equal(Boolean(flags & 128), enabled && !counters.has(pid), `discontinuity PID ${pid} at ${offset}`);
    const cc = packet[3]! & 15;
    assert.equal(cc, counters.has(pid) ? (counters.get(pid)! + 1) & 15 : 0);
    counters.set(pid, cc);
    assert.ok(packet[3]! & 16);
    const start = 4 + ((packet[3]! & 32) ? packet[4]! + 1 : 0);
    if (pid < 32 || pid === 4096) continue;
    const payload = payloads.get(pid) ?? [];
    payload.push(...packet.subarray(start));
    payloads.set(pid, payload);
    if (packet[1]! & 64) {
      const markers = randomAccess.get(pid) ?? [];
      markers.push(Boolean(flags & 64));
      randomAccess.set(pid, markers);
    }
  }
  assert.ok(counters.has(17));
  assert.ok(counters.has(0));
  assert.ok(counters.has(4096));
  assert.ok(counters.has(256));
  return { payloads, randomAccess };
}

it("matches the native first-packet discontinuity pattern", () => {
  for (const enabled of [false, true]) {
    inspect(readFileSync(new URL(`./fixtures/mpegts-discontinuity-${enabled ? "native" : "plain"}.ts.bin`, import.meta.url)), enabled);
  }
});

it("serializes initial discontinuities without changing PES data or random-access flags", () => {
  for (const bytes of [input, createSyntheticMp4({ width: 16, height: 16, durationSeconds: 0.2, includeAudio: true })]) {
    const doc = parseMp4(bytes, { decodeFrames: false, decodeAudio: false });
    const baseline = serializeMpegTs(doc);
    assert.deepEqual(serializeMpegTs(doc, { initialDiscontinuity: false }), baseline);
    assert.deepEqual(inspect(serializeMpegTs(doc, { initialDiscontinuity: true }), true), inspect(baseline, false));
  }
});

it("decodes the same pictures as native FFmpeg with and without discontinuities", () => {
  const native = readFileSync(new URL("./fixtures/mpegts-discontinuity-native.ts.bin", import.meta.url));
  const pictures = (bytes: Uint8Array) => parseMpegTs(bytes, { decodeFrames: true }).tracks[0]!.decodedVideoFrames!.map(frame => frame.data);
  const expected = pictures(native);
  assert.equal(expected.length, 15);
  const doc = parseMp4(input, { decodeFrames: false, decodeAudio: false });
  for (const initialDiscontinuity of [false, true]) {
    assert.deepEqual(pictures(serializeMpegTs(doc, { initialDiscontinuity })), expected);
  }
});

for (const sync of [false, true]) {
  for (const [flags, enabled] of [
    [[], false], [["+initial_discontinuity"], true], [["initial_discontinuity"], true],
    [["32"], true], [["0x20"], true], [["+initial_discontinuity", "-initial_discontinuity"], false],
    [["initial_discontinuity", "0"], false], [["initial_discontinuity-initial_discontinuity"], false]
  ] as const) {
    it(`supports initial discontinuity ${JSON.stringify(flags)} (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/input.mp4": input });
      const args = ["-y", "-i", "/input.mp4", "-c", "copy", ...flags.flatMap(flag => ["-mpegts_flags", flag]), "/out.ts"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
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
        assert.equal(result.exitCode, 0, stderr);
      }
      inspect(volume.readFileSync("/out.ts") as Buffer, enabled);
    });
  }
}
