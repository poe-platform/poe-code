import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { deflateSync } from "node:zlib";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/dialoguenhance-ashowinfo.wav", import.meta.url));
// Native FFmpeg 7.0.2 left/right float plane checksums. The center FFT is
// implementation dependent, so compare its checksum against the actual float
// output using zlib, independently of ashowinfo and the final PCM16 encoder.
const sideChecksums = [
  ["00000000", "00000000"], ["00000000", "00000000"], ["00000000", "00000000"],
  ["B5C8F52A", "B5C8F52A"], ["B216ED11", "B216ED11"], ["73E7EDA4", "73E7EDA4"],
  ["F1CEF879", "F1CEF879"], ["3EE1EA1E", "6B47BE55"]
];

function checksum(bytes: Buffer): string {
  const compressed = deflateSync(bytes);
  const adler = compressed.readUInt32BE(compressed.length - 4);
  // zlib seeds Adler-32 with 1; FFmpeg seeds it with 0.
  const low = ((adler & 0xffff) + 65520) % 65521;
  const high = ((adler >>> 16) - bytes.length % 65521 + 65521) % 65521;
  return (high * 65536 + low).toString(16).padStart(8, "0").toUpperCase();
}

for (const graph of [false, true]) {
  for (const filter of ["ashowinfo", "dialoguenhance,ashowinfo", "dialoguenhance,anull,ashowinfo", "dialoguenhance,aformat=f=s16,ashowinfo"]) {
    it(`${filter} exposes samples independently of WAV encoding (${graph ? "graph" : "simple"})`, async () => {
      const expectedFrames: string[] = [];
      for (const codec of ["pcm_f32le", "pcm_s16le"]) {
        const fs = Volume.fromJSON({});
        fs.writeFileSync("/in.wav", input);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "info", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", codec, "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(p: string) { return fs.readFileSync(p); },
            async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
            async stat(p: string) { return fs.statSync(p); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        const frames = stderr.trim().split("\n");
        assert.equal(frames.length, 8);
        const raw = filter === "ashowinfo";
        const planar = !raw && !filter.includes("aformat");
        const description = `fmt:${planar ? "fltp" : "s16"} channels:${raw ? 2 : 3} chlayout:${raw ? "stereo" : "3.0"} rate:8000`;
        for (const [n, line] of frames.entries()) {
          const prefix = `[ashowinfo] n:${n} pts:${n * 512} pts_time:${n * 0.064} ${description} nb_samples:512`;
          assert.ok(line.startsWith(prefix), line);
          if (planar) {
            if (codec === "pcm_f32le") {
              const planes = audio.channelData.map(channel => {
                const bytes = Buffer.alloc(512 * 4);
                for (let i = 0; i < 512; i++) bytes.writeFloatLE(channel[n * 512 + i]!, i * 4);
                return bytes;
              });
              const sums = planes.map(checksum);
              assert.deepEqual(sums.slice(0, 2), sideChecksums[n]);
              if (n === 0) assert.notEqual(sums[2], "00000000");
              expectedFrames.push(`${prefix} checksum:${checksum(Buffer.concat(planes))} plane_checksums: [ ${sums.join(" ")} ]`);
            }
            assert.equal(line, expectedFrames[n]);
          } else if (n === 0) {
            const checksum = raw ? "6D5CF885" : "00000000";
            assert.equal(line, `${prefix} checksum:${checksum} plane_checksums: [ ${checksum} ]`);
          }
        }
        assert.equal(audio.channels, raw ? 2 : 3);
        assert.equal(audio.sampleRate, 8000);
        const source = parseWav(input).tracks[0]!.decodedAudio!;
        for (let c = 0; c < 2; c++) {
          assert.equal(audio.channelData[c]!.length, 4096);
          for (let i = 0; i < 4096; i++) {
            assert.equal(audio.channelData[c]![i], !raw && i < 1536 ? 0 : source.channelData[c]![i - (raw ? 0 : 1536)]);
          }
        }
        if (planar && codec === "pcm_f32le") {
          assert.ok(audio.channelData[2]!.subarray(0, 512).some(value => value !== 0));
        } else if (!raw) {
          assert.ok(audio.channelData[2]!.subarray(0, 512).every(value => value === 0));
        }
      }
    });
  }
}
