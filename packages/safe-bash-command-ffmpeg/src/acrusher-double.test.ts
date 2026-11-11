import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static Linux x86_64, also verified with -cpuflags 0.
for (const [filter, format, expected] of [
  ["acrusher=bits=1:mode=log:aa=0.5:mix=0.25", "f64le", "88929037ec9de2bf"],
  ["acrusher=bits=1:mode=log:aa=0.5:mix=0.25", "s32le", "224f88b5"],
  ["acrusher=bits=1:mode=log:aa=0:mix=0.25", "f64le", "b26085fe69d5e1bf"],
  ["acrusher=bits=1:mode=lin:aa=0.5:mix=0.25", "f64le", "000000000000eebf"],
  ["anull", "f64le", "000000000000e8bf"]
] as const) for (const graph of [false, true]) {
  it(`matches native double-input ${filter} to ${format} through ${graph ? "filter_complex" : "af"}`, async () => {
    const input = Buffer.alloc(8);
    input.writeDoubleLE(-0.75);
    const volume = Volume.fromJSON({ "/in.raw": input });
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "f64le", "-ac", "1", "-ar", "8000", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", format, "pipe:1"],
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
    assert.equal(stderr, "");
    assert.equal(Buffer.concat(chunks).toString("hex"), expected);
  });
}
