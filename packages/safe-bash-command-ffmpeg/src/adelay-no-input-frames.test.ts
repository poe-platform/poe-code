import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: buffered upstream audio leaves common padding at NOPTS
// and the delay tail at a negative timestamp, even though muxing starts at zero.
for (const upstream of ["aresample=16000", "atempo=1.1"]) {
  for (const complex of [false, true]) {
    for (const [delay, selector, format, expected] of [
      ["1S|4S", "", "framecrc", ["0,0,0,1,4,0x00000000", "0,1,1,3,12,0x00000000"]],
      ["1S|4S", ",aselect=isnan(pts)", "s16le", 4],
      ["1S|4S", ",aselect='lt(t,0)'", "s16le", 12],
      ["1S|4S", "", "s16le", 16],
      ["1S:all=1", "", "framecrc", ["0,0,0,1,4,0x00000000"]]
    ] as const) {
      it(`delay without upstream frames: ${upstream},${delay}${selector} ${format} (complex=${complex})`, async () => {
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000,
          channels: [1, -1].map(sign => Float64Array.from({ length: 6 }, (_, i) => sign * (i + 1) * 1000 / 32768)) })) });
        const filter = `${upstream},adelay=${delay}${selector}`;
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", ...(complex
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-bitexact", "-f", format, "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = Buffer.concat(stdout);
        if (typeof expected === "number") assert.deepEqual(output, Buffer.alloc(expected));
        else assert.deepEqual(output.toString().split("\n").filter(line => line && !line.startsWith("#"))
          .map(line => line.split(",").map(field => field.trim()).join(",")), expected);
      });
    }
  }
}
