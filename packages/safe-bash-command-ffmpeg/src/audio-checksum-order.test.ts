import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const format of ["hash", "md5", "crc"]) {
  for (const differentRates of [false, true]) {
    for (const reverse of [false, true]) {
      for (const codec of ["pcm_s16le", "copy"]) {
        it(`${format} interleaves ${codec} packets (different rates=${differentRates}, reverse=${reverse})`, async () => {
          const fs = Volume.fromJSON({});
          const lengths = differentRates ? [1200, 1400] : [1200, 1200];
          const rates = [8000, differentRates ? 16000 : 8000];
          for (let stream = 0; stream < 2; stream++) {
            fs.writeFileSync(`/${stream}.wav`, encodeWav({ sampleRate: rates[stream]!,
              channels: [Float64Array.from({ length: lengths[stream]! }, (_, i) => (i + 2000 * stream) / 32768)] }));
          }
          const maps = reverse ? [1, 0] : [0, 1];
          let stdout = "", stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-v", "error", "-i", "/0.wav", "-i", "/1.wav",
              ...maps.flatMap(stream => ["-map", `${stream}:a`]), "-c:a", codec, "-f", format, "-"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return fs.readFileSync(path); },
              async stat(path: string) { return fs.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          // WAV packets contain 512 samples at 8 kHz and 1024 at 16 kHz.
          const packets = maps.flatMap(stream => {
            const packets: { time: number; bytes: Uint8Array }[] = [];
            const size = rates[stream] === 8000 ? 512 : 1024;
            for (let start = 0; start < lengths[stream]!; start += size) {
              const bytes = new Uint8Array(Math.min(size, lengths[stream]! - start) * 2);
              const view = new DataView(bytes.buffer);
              for (let i = 0; i < bytes.length / 2; i++) view.setInt16(i * 2, start + i + 2000 * stream, true);
              packets.push({ time: start / rates[stream]!, bytes });
            }
            return packets;
          }).sort((a, b) => a.time - b.time);
          const payload = Buffer.concat(packets.map(packet => packet.bytes));
          let expected: string;
          if (format === "crc") {
            let a = 1, b = 0;
            for (const byte of payload) { a = (a + byte) % 65521; b = (b + a) % 65521; }
            expected = `CRC=0x${((b * 65536 + a) >>> 0).toString(16).padStart(8, "0")}\n`;
          } else {
            const algorithm = format === "md5" ? "md5" : "sha256";
            expected = `${algorithm.toUpperCase()}=${createHash(algorithm).update(payload).digest("hex")}\n`;
          }
          if (!differentRates && !reverse) {
            assert.equal(expected, { hash: "SHA256=b83df28d8d82b4fb946427197f7250079b31158b4443ab54f3e73329a2aff8d4\n",
              md5: "MD5=cfe50f00d3ed568cb5e505a3d1204093\n", crc: "CRC=0xd0c9b99d\n" }[format]);
          }
          assert.equal(stdout, expected);
        });
      }
    }
  }
}
