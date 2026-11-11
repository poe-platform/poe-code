import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  it(`preserves native double dialogue samples (${complex ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(16 * 8);
    for (let i = 0; i < 16; i++) input.writeDoubleLE([0, .123456789, -.34567891, .77777777][i % 4]!, i * 8);
    const volume = Volume.fromJSON({ "/in.pcm": input });
    const chunks: Buffer[] = [];
    let stderr = "";
    const filters = complex ? ["-filter_complex", "[0:a]dialoguenhance[s]", "-map", "[s]"] : ["-af", "dialoguenhance"];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "f64le", "-ar", "1000", "-ac", "1", "-i", "/in.pcm", ...filters, "-f", "f64le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = Buffer.concat(chunks);
    assert.equal(output.length, 384);
    // FFmpeg 7.0.2-static, with both default CPU flags and -cpuflags 0.
    assert.equal(createHash("sha256").update(output).digest("hex"),
      "3e539ad9bb6f3650c18599078d543da04678f60379f6c34aecaabfef28e247f5");
  });
}

for (const sampleRate of [1000, 96000, 192000]) {
  it(`retains delayed double stereo samples at ${sampleRate} Hz`, async () => {
    const size = sampleRate > 100000 ? 8192 : sampleRate > 50000 ? 4096 : 2048;
    const delay = size * 3 / 4;
    const input = Buffer.alloc((delay + 16) * 16);
    for (let i = 0; i < 16; i++) {
      input.writeDoubleLE(.123456789 + i / 100, i * 16);
      input.writeDoubleLE(-.34567891 + i / 100, i * 16 + 8);
    }
    const volume = Volume.fromJSON({ "/in.pcm": input });
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "f64le", "-ar", String(sampleRate), "-ac", "2", "-i", "/in.pcm",
        "-af", "dialoguenhance=original=0:enhance=0", "-f", "f64le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = Buffer.concat(chunks);
    assert.equal(output.length, (delay + 16) * 24);
    for (let i = 0; i < delay + 16; i++) {
      assert.equal(output.readDoubleLE(i * 24), i < delay ? 0 : input.readDoubleLE((i - delay) * 16));
      assert.equal(output.readDoubleLE(i * 24 + 8), i < delay ? 0 : input.readDoubleLE((i - delay) * 16 + 8));
      assert.equal(output.readDoubleLE(i * 24 + 16), 0);
    }
  });
}
