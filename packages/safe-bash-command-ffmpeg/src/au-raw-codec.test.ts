import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2: AU pcm_s16be samples [1, 511, -999, 1000].
const input = Buffer.from("2e736e6400000018000000080000000300001f4000000001000101fffc1903e8", "hex");

for (const sync of [false, true]) {
  for (const [format, codec, expected] of [
    ["s16le", "copy", undefined],
    ["s8", "copy", undefined],
    ["s16be", "copy", "000101fffc1903e8"],
    ["s16le", "pcm_s16le", "0100ff0119fce803"]
  ] as const) {
    it(`writes AU audio to ${format} with ${codec} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.au": input, "/out.raw": "KEEP" });
      const args = ["-v", "error", "-y", "-i", "/in.au", "-c:a", codec, "-f", format, "/out.raw"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), expected === undefined ? undefined : "");
        // Rejected synchronous attempts defer to async execution without side effects.
        if (expected === undefined) {
          assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
          return;
        }
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, expected === undefined ? 234 : 0, stderr);
        if (expected === undefined) assert.ok(stderr.includes(`${format} muxer supports only codec pcm_${format} for type audio`), stderr);
        else assert.equal(stderr, "");
      }
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(expected ?? "", "hex"));
    });
  }
}

for (const [target, overwrite, exitCode] of [
  ["pipe:1", "-y", 234],
  ["-", "-y", 234],
  ["/dev/null", "-y", 234],
  ["/out.raw", "-n", 0]
] as const) {
  it(`does not write rejected AU copy output to ${target} with ${overwrite}`, async () => {
    const volume = Volume.fromJSON({ "/in.au": input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", overwrite, "-i", "/in.au", "-c:a", "copy", "-f", "s16le", target],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile() { assert.fail("rejected output must not write a file"); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() { assert.fail("rejected output must not write stdout"); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.ok(stderr.includes(overwrite === "-n" ? "already exists" : "s16le muxer supports only codec pcm_s16le"), stderr);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}
