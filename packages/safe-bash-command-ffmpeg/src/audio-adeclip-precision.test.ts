import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// SHA-256 of FFmpeg 7.0.2-static f64le output; the default fixture also matches
// with -cpuflags 0. Longer input covers repeated overlap-add and the window tail.
for (const [filter, rate, length, expected] of [
  ["adeclip", 1000, 16, "2a141ec6443ab312741d1a02b2531264e975937ac84f5f2f7f8bcd322990dc81"],
  ["adeclip=m=save", 1000, 16, "a5ead0830da49a19ac2ab1da77c6b0f071f728d1bc7e9dc9afd8f07ce4d622f4"],
  ["anull", 1000, 16, "a5ead0830da49a19ac2ab1da77c6b0f071f728d1bc7e9dc9afd8f07ce4d622f4"],
  ["adeclip=o=50", 1000, 16, "9d7b183699b55debbb3a953981f77da1b7dd4738a532136ad54eb750a893a254"],
  ["adeclip=o=95", 1000, 16, "e65bcb03498895fcb2dd2e5efb9aa82944440c7226a4b92aa0c699a39d6d97c7"],
  ["adeclip", 8000, 16, "d4ea49f2c93a47a1256d0a15f07172d2e59f9469aba3450911c507c81bce16d3"],
  ["adeclip=t=100", 1000, 301, "d5d3ea556bcd0f9c768afed7e7ddb169f96d5fc716552b6108e846bc9a2fcf89"],
  ["adeclick=t=100", 1000, 16, "2a141ec6443ab312741d1a02b2531264e975937ac84f5f2f7f8bcd322990dc81"]
] as const) for (const graph of [false, true]) {
  it(`matches native double PCM through ${filter}, ${length} samples at ${rate} Hz (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(length * 8);
    for (let i = 0; i < length; i++) input.writeDoubleLE([0, .123456789, -.34567891, .77777777][i % 4]!, i * 8);
    const volume = Volume.fromJSON({ "/in.pcm": input });
    const output: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "f64le", "-ar", String(rate), "-ac", "1", "-i", "/in.pcm",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "f64le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = Buffer.concat(output);
    assert.equal(pcm.length, input.length);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), expected);
  });
}
