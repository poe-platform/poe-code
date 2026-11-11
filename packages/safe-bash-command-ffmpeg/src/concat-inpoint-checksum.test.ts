import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: seeking either file leaves an eight-sample packet beside a
// sixteen-sample packet, including when decoding without an explicit filter.
for (const seek of ["a", "b"]) {
  for (const format of ["framecrc", "framehash", "framemd5", "s16le"]) {
    for (const mode of ["decode", "copy", "filter"]) {
      it(`concat inpoint on ${seek} preserves ${format} packets with ${mode}`, async () => {
        const volume = Volume.fromJSON({
          "/list.ffconcat": `ffconcat version 1.0\nfile a.wav\n${seek === "a" ? "inpoint 0.001\n" : ""}file b.wav\n${seek === "b" ? "inpoint 0.001\n" : ""}`
        });
        const packets: Buffer[] = [];
        for (const [name, base] of [["a", 100], ["b", 200]] as const) {
          volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
            channels: [Float64Array.from({ length: 16 }, (_, i) => (base + i) / 32768)] }));
          const start = name === seek ? 8 : 0;
          const pcm = Buffer.alloc((16 - start) * 2);
          for (let i = start; i < 16; i++) pcm.writeInt16LE(base + i, (i - start) * 2);
          packets.push(pcm);
        }
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "concat", "-i", "/list.ffconcat", "-bitexact",
            ...(mode === "copy" ? ["-c", "copy"] : mode === "filter" ? ["-af", "anull"] : []),
            "-f", format, "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        const output = Buffer.concat(stdout);
        if (format === "s16le") {
          assert.deepEqual(output, Buffer.concat(packets));
          return;
        }
        const checksums = seek === "a" ? ["0x1f08037c", "0xd9d00cf8"] : ["0x6f9006b8", "0x3b28069c"];
        let pts = 0;
        const expected = packets.map((packet, index) => {
          const duration = packet.length / 2;
          const hash = format === "framecrc" ? checksums[index]!
            : createHash(format === "framehash" ? "sha256" : "md5").update(packet).digest("hex");
          const row = ["0", String(pts), String(pts), String(duration), String(packet.length), hash];
          pts += duration;
          return row;
        });
        const rows = output.toString().trim().split("\n").filter(line => !line.startsWith("#"))
          .map(line => line.split(",").map(field => field.trim()));
        assert.deepEqual(rows, expected);
      });
    }
  }
}
