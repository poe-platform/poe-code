import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: declined commands leave the complete PCM16 output unchanged.
for (const target of ["aphaser", "aphaser@v"]) {
  for (const command of ["", "decay 0.9", "speed 2"]) {
    for (const graph of [false, true]) {
      const filter = command ? `asendcmd=c=0 ${target} ${command},${target}` : target;
      it(`${filter} matches native status and output (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from({ length: 16 }, (_, i) => ((i * 7919 + 3467) % 49001 - 24500) / 32768)
        ] }, { bitsPerSample: 16 }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
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
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 32);
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "a131cc632affa5d8e011b45e4baafd4b6d7dfdc47a3727a560f5044255fda00c");
      });
    }
  }
}
