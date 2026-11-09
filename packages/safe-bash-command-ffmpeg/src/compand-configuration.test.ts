import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: configuration failures open/truncate output;
// option-parse failures leave it untouched, including when both are invalid.
for (const graph of [false, true]) {
  for (const existing of [false, true]) {
    for (const [options, configuration] of [
      ["attacks=-1", true], ["decays=-1", true], ["points=0/0|-20/-30", true],
      ["attacks=0|1:decays=0", true], ["attacks=0:decays=0|1", true],
      ["gain=0b1", false], ["attacks=-1:gain=0b1", false],
      ["points=0/0|-20/-30:gain=0b1", false]
    ] as const) {
      it(`compand ${options}, ${graph ? "graph" : "simple"}, ${existing ? "existing" : "new"} output`, async () => {
        const fs = Volume.fromJSON(existing ? { "/out.pcm": "123456789" } : {});
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25]), new Float64Array([-0.25])] }));
        let stderr = "";
        const filter = `compand=${options}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
            : ["-af", filter]), "-f", "s16le", "/out.pcm"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 234, stderr);
        assert.ok(stderr.includes("compand"), stderr);
        assert.equal(fs.existsSync("/out.pcm"), configuration || existing);
        if (configuration || existing) {
          assert.equal(fs.readFileSync("/out.pcm", "utf8"), configuration ? "" : "123456789");
        }
      });
    }
  }
}

for (const [target, format, overwrite, expected] of [
  ["pipe:1", "s16le", "-y", 234], ["-", "null", "-y", 234],
  ["/dev/null", "s16le", "-y", 234], ["/out.pcm", "null", "-y", 234],
  ["/out.pcm", "s16le", "-n", 0]
] as const) {
  it(`compand configuration failure respects ${target}, ${format}, ${overwrite}`, async () => {
    const fs = Volume.fromJSON({ "/out.pcm": "123456789" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25]), new Float64Array([-0.25])] }));
    let written = 0;
    const result = await createFfmpegCommand().execute({
      args: [overwrite, "-i", "/in.wav", "-af", "compand=attacks=-1", "-f", format, target],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { written++; fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { written += bytes.length; } },
      stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, expected);
    assert.equal(written, 0);
    assert.equal(fs.readFileSync("/out.pcm", "utf8"), "123456789");
  });
}
