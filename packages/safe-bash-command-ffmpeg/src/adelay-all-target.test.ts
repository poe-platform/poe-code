import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reference PCM for the same raw stereo input and argv.
for (const graph of [false, true]) {
  for (const target of ["", "adelay@a", "all", "missing"]) {
    it(`delivers scheduled delays to ${target || "no target"} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(4096 * 4);
      for (let i = 0; i < 4096; i++) {
        input.writeInt16LE(100 + i, i * 4);
        input.writeInt16LE(2000 + i, i * 4 + 2);
      }
      const fs = Volume.fromJSON({ "/in.pcm": input });
      const filter = `${target ? `asendcmd=c='0.125 ${target} delays 8S|1S',` : ""}adelay@a=2S|5S`;
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.pcm",
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
      const updated = target === "adelay@a" || target === "all";
      assert.equal(output.length, (updated ? 4106 : 4101) * 4);
      assert.equal(createHash("sha256").update(output).digest("hex"), updated
        ? "8e5d10e97eef6ccd1e4486655ad02e8ca225889dcb09e768b42df4d15b8dfcc9"
        : "265b05abe643b6c6e3766ecbd9cd3d0c165ef05c4e4b3fee948fed090c769b61");
    });
  }
}
