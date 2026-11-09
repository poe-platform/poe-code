import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, serializeMpegTs } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg fixture: 20 H.264 frames at 20 fps, with only the first frame a keyframe.
const input = readFileSync(new URL("./fixtures/mpegts-pat-period.mp4", import.meta.url));
const document = parseMp4(input, { decodeFrames: false, decodeAudio: false });

function inspect(bytes: Uint8Array) {
  const pats: number[] = [];
  const pmts: number[] = [];
  const payloads: number[][] = [];
  const counters = new Map<number, number>();
  const sections = new Map<number, Uint8Array>();
  let pmtPid = -1;
  let videoPid = -1;
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = bytes.subarray(offset, offset + 188);
    assert.equal(packet.length, 188);
    assert.equal(packet[0], 0x47);
    const pid = ((packet[1]! & 31) << 8) | packet[2]!;
    if (!(packet[3]! & 16)) continue;
    const cc = packet[3]! & 15;
    if (counters.has(pid)) assert.equal(cc, (counters.get(pid)! + 1) & 15);
    counters.set(pid, cc);
    let start = 4 + ((packet[3]! & 32) ? packet[4]! + 1 : 0);
    const begins = (packet[1]! & 64) !== 0;
    if (pid === videoPid) {
      if (begins) {
        assert.deepEqual([...packet.subarray(start, start + 3)], [0, 0, 1]);
        payloads.push([]);
      }
      payloads.at(-1)!.push(...packet.subarray(start));
    } else if (begins && (pid === 0 || pid === pmtPid)) {
      start += packet[start]! + 1;
      const length = ((packet[start + 1]! & 15) << 8) | packet[start + 2]!;
      const section = packet.slice(start, start + 3 + length);
      let crc = 0xffffffff;
      for (const byte of section) {
        crc ^= byte << 24;
        for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ ((crc & 0x80000000) ? 0x04c11db7 : 0);
      }
      assert.equal(crc >>> 0, 0, "valid section CRC");
      if (sections.has(pid)) assert.deepEqual(section, sections.get(pid), "stable table version and contents");
      sections.set(pid, section);
      if (pid === 0) {
        pats.push(payloads.length);
        pmtPid = ((section[10]! & 31) << 8) | section[11]!;
      } else {
        pmts.push(payloads.length);
        const stream = 12 + (((section[10]! & 15) << 8) | section[11]!);
        videoPid = ((section[stream + 1]! & 31) << 8) | section[stream + 2]!;
      }
    }
  }
  assert.equal(payloads.length, 20);
  assert.deepEqual(pats, pmts, "PAT and PMT precede the same PES starts");
  return { pats, payloads };
}

for (const enabled of [false, true]) {
  it(`serializes PAT/PMT at ${enabled ? "every frame" : "half-second intervals"}`, () => {
    const video = document.tracks.find(track => track.type === "video")!;
    assert.equal(video.samples.filter(sample => sample.isKeyframe).length, 1);
    const baseline = inspect(serializeMpegTs(document, { patPeriod: 0.5 }));
    const actual = inspect(serializeMpegTs(document, { patPeriod: 0.5, patPmtAtFrames: enabled }));
    assert.deepEqual(actual.pats, enabled ? Array.from({ length: 20 }, (_, i) => i) : [0, 10]);
    assert.deepEqual(actual.payloads, baseline.payloads, "PES data and timestamps stay unchanged");
  });
}

for (const sync of [false, true]) {
  for (const [flags, enabled] of [
    [[], false], [["+pat_pmt_at_frames"], true], [["pat_pmt_at_frames"], true],
    [["16"], true], [["latm+pat_pmt_at_frames"], true], [["24"], true],
    [["pat_pmt_at_frames", "+latm"], true], [["pat_pmt_at_frames", "latm"], false], [["+pat_pmt_at_frames", "-pat_pmt_at_frames"], false],
    [["pat_pmt_at_frames", "0"], false]
  ] as const) {
    it(`muxes every video frame with flags ${JSON.stringify(flags)} (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/input.mp4": input });
      const args = ["-y", "-i", "/input.mp4", ...(sync ? [] : ["-map", "0:v:0"]), "-c", "copy", "-pat_period", "0.5",
        ...flags.flatMap(flag => ["-mpegts_flags", flag]), "/out.ts"];
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
      const actual = inspect(volume.readFileSync("/out.ts") as Buffer);
      assert.deepEqual(actual.pats, enabled ? Array.from({ length: 20 }, (_, i) => i) : [0, 10]);
    });
  }
}

it("does not repeat tables for audio-only frames", () => {
  const audio = parseMp4(readFileSync(new URL("./fixtures/frame-checksum-tone.m4a", import.meta.url)), { decodeAudio: false });
  assert.deepEqual(serializeMpegTs(audio, { patPeriod: 10, patPmtAtFrames: true }),
    serializeMpegTs(audio, { patPeriod: 10 }));
});

for (const value of ["", "unknown", "4096", "pat_pmt_at_frames+"]) {
  it(`rejects unsupported MPEG-TS flags ${JSON.stringify(value)} before replacing output`, async () => {
    const volume = Volume.fromJSON({ "/input.mp4": input, "/out.ts": "keep output" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/input.mp4", "-c", "copy", "-mpegts_flags", value, "/out.ts"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("mpegts_flags"), stderr);
    assert.equal(volume.readFileSync("/out.ts", "utf8"), "keep output");
  });
}

it("keeps per-frame flags scoped to each output", async () => {
  const volume = Volume.fromJSON({ "/input.mp4": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/input.mp4", "-c", "copy", "-pat_period", "0.5",
      "-mpegts_flags", "+pat_pmt_at_frames", "/each.ts", "-c", "copy", "-pat_period", "0.5", "/periodic.ts"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(inspect(volume.readFileSync("/each.ts") as Buffer).pats, Array.from({ length: 20 }, (_, i) => i));
  assert.deepEqual(inspect(volume.readFileSync("/periodic.ts") as Buffer).pats, [0, 10]);
});
