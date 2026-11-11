import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const pcm = Buffer.from("30f84ff86ef88df8acf8cbf8eaf809f928f947f966f985f9", "hex");

for (const position of ["input", "output"]) {
  for (const selector of ["", ":a", ":a:0", ":0", ":v", ":a:1"]) {
    it(`accepts ${position} -sample_fmt${selector} on raw PCM`, async () => {
      const volume = Volume.fromJSON({});
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const option = [`-sample_fmt${selector}`, "s16"];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1",
          ...(position === "input" ? option : []), "-i", "pipe:0",
          ...(position === "output" ? option : []), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { yield pcm; })(),
        stdout: { async write(data: Uint8Array) { stdout.push(data); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(Buffer.concat(stdout), pcm);
    });
  }
}

for (const selector of [":a", ":a:0", ":0", ":v", ":a:1"]) {
  for (const sync of [false, true]) {
    it(`preserves PCM32 precision with -sample_fmt${selector} (sync=${sync})`, async () => {
      const input = Buffer.from("12345678efcdab89", "hex");
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", input);
      const args = ["-v", "error", "-f", "s32le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-sample_fmt", "s32", `-sample_fmt${selector}`, [":v", ":a:1"].includes(selector) ? "s16" : "s32",
        "-f", "s32le", "/out.raw"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
      }
      assert.deepEqual(volume.readFileSync("/out.raw"), input);
    });
  }
}
