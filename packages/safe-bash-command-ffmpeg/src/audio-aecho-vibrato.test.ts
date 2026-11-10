import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { readFileSync } from "node:fs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg s16le reference hashes for echo followed by vibrato.
const input = readFileSync(new URL("./fixtures/vibrato-timeline.wav", import.meta.url));

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.wav": input, "/out.pcm": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.pcm") as Buffer };
}

for (const graph of [false, true]) {
  for (const [suffix, hash] of [
    ["vibrato", "e0ac31bad376391c6a0c0a253ef30f44e422bb7aafc5b745536088b2418610c5"],
    ["vibrato=enable=0", "4716d0410f80b030ffe66b11a243a3576d64d4f11d50668ee8e5df73cfc705b0"],
    ["anull,acopy,vibrato", "e0ac31bad376391c6a0c0a253ef30f44e422bb7aafc5b745536088b2418610c5"],
    ["aformat=dblp,vibrato", "e0ac31bad376391c6a0c0a253ef30f44e422bb7aafc5b745536088b2418610c5"],
    ["aformat=s16p,vibrato", "2e5ef637bab91a3877cdbb117ec79611e199997de7e9e742de1372459658dcf5"],
    ["aformat=dblp,vibrato=enable=0", "4716d0410f80b030ffe66b11a243a3576d64d4f11d50668ee8e5df73cfc705b0"],
    ["aformat=s16p,vibrato=enable=0", "914692f129564d98f9f87350e769b1cb3d7027a2121dfe26333674e6326a5c4f"]
  ]) {
    it(`echo negotiates native precision for ${suffix} (graph ${graph})`, async () => {
      const { result, stderr, output } = await run(`aecho=0.5:1:1:0.5,${suffix}`, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 24016);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
