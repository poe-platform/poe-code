import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(8192 * 2);
for (let i = 0; i < 8192; i++) input.writeInt16LE(12001 + i % 100, i * 2);
const intro = "afade@a=t=in:ss=1024:ns=1024";
const fades = `${intro},afade@b=t=out:ss=4096:ns=2048`;

// Native FFmpeg 7.0.2 PCM16 hashes: all stops at the first accepting fade.
for (const graph of [false, true]) {
  for (const [filter, digest] of [
    [intro, "c61165f9abea8d6475964302138ef6eb0f2aabad7a6864cfae7858471cc65972"],
    [`asendcmd=c='0.25 afade@a unity 0.5',${intro}`, "c21ab414909b693ff6cf29c66c29de1e68c6a428b3516b00835be6fabd15516e"],
    [`asendcmd=c='0.25 all unity 0.5',${intro}`, "c21ab414909b693ff6cf29c66c29de1e68c6a428b3516b00835be6fabd15516e"],
    [fades, "29d5b00a31e089c06232fa93d4e2fe009f8d13b9778b2efa8646090cab86c907"],
    [`asendcmd=c='0.25 afade@a unity 0.5',${fades}`, "f760e305981a9e2778bf9c91b612acf7d8f3d5b4bbe32b515232d44300429f66"],
    [`asendcmd=c='0.25 afade@b unity 0.5',${fades}`, "22d839672459bc5354ddc3079a751b63ee312d985ab706d86b848f79d5cad5c0"],
    [`asendcmd=c='0.25 all unity 0.5',${fades}`, "f760e305981a9e2778bf9c91b612acf7d8f3d5b4bbe32b515232d44300429f66"]
  ] as const) {
    it(`afade command target: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({ "/in.pcm": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = Buffer.concat(stdout);
      assert.equal(output.length, input.length);
      assert.equal(createHash("sha256").update(output).digest("hex"), digest);
    });
  }
}
