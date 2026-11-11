import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const pcm = Buffer.alloc(1100 * 4);
const channels = [new Float64Array(1100), new Float64Array(1100)];
for (let i = 0; i < 1100; i++) {
  const left = i * 101 % 30001 - 15000;
  const right = 10000 - i * 53 % 20001;
  pcm.writeInt16LE(left, i * 4);
  pcm.writeInt16LE(right, i * 4 + 2);
  channels[0]![i] = left / 32768;
  channels[1]![i] = right / 32768;
}
const input = encodeWav({ sampleRate: 8000, channels });

for (const filteredStream of [undefined, 0, 1]) {
  for (const format of ["hash", "md5", "crc", "framehash", "streamhash"]) {
    it(`${format} preserves mapped PCM packet order with filtered stream ${filteredStream ?? "none"}`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", input);
      let stdout = "", stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", "-bitexact", "-map", "0:a", "-map", "0:a",
          ...(filteredStream === undefined ? [] : [`-filter:a:${filteredStream}`, "volume=0"]),
          "-f", format, "pipe:1"],
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
      assert.equal(stderr, "");
      // Native FFmpeg 7.0.2 emits 512 stereo samples per WAV packet,
      // with the lower mapped output index first at equal timestamps.
      const streams = [0, 1].map(stream => stream === filteredStream ? Buffer.alloc(pcm.length) : pcm);
      const packets = [0, 512, 1024].flatMap(start => streams.map((bytes, stream) => ({
        stream, start, duration: Math.min(512, 1100 - start),
        bytes: bytes.subarray(start * 4, Math.min(start + 512, 1100) * 4)
      })));
      if (format === "framehash") {
        const rows = stdout.split("\n").filter(line => line && !line.startsWith("#"));
        assert.deepEqual(rows.map(row => row.split(",").map(field => field.trim())),
          packets.map(packet => [String(packet.stream), String(packet.start), String(packet.start),
            String(packet.duration), String(packet.bytes.length),
            createHash("sha256").update(packet.bytes).digest("hex")]));
        assert.deepEqual(stdout.split("\n").filter(line => line.startsWith("#channel_layout_name")),
          ["#channel_layout_name 0: stereo", "#channel_layout_name 1: stereo"]);
      } else if (format === "streamhash") {
        assert.equal(stdout, streams.map((bytes, stream) =>
          `${stream},a,SHA256=${createHash("sha256").update(bytes).digest("hex")}\n`).join(""));
      } else {
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
        if (filteredStream === 1) {
          assert.equal(expected, {
            hash: "SHA256=5fd55872f811b709502c7c2a5d3fae6acb6b6fe71a6a099523a701d47a0aa595\n",
            md5: "MD5=17e67f11a3723424ce69b1f6ab856b2a\n",
            crc: "CRC=0x3df79fa7\n"
          }[format]);
        }
        assert.equal(stdout, expected);
      }
    });
  }
}
