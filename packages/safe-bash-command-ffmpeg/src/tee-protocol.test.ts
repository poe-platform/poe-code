import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const target of ["tee:first.pcm|second.pcm", "tee:first.pcm|absent/second.pcm", "tee:first.pcm|in.wav"]) {
  it(`writes local tee protocol destinations: ${target}`, async () => {
    const input = Buffer.from(encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from({ length: 64 }, (_, i) => (i - 32) / 32768),
      Float64Array.from({ length: 64 }, (_, i) => (32 - i) / 32768)
    ] }));
    const volume = Volume.fromJSON({ "/in.wav": input, "/first.pcm": "KEEP", "/second.pcm": "KEEP" });
    let stderr = "";
    const run = (output: string) => createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "in.wav", "-c:a", "pcm_s16be", "-f", "s16be", output],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal((await run("control.pcm")).exitCode, 0, stderr);
    const result = await run(target);
    if (target.includes("absent/")) {
      assert.notEqual(result.exitCode, 0);
      assert.match(stderr, /ENOENT/);
      assert.equal((volume.readFileSync("/first.pcm") as Buffer).byteLength, 0);
    } else if (target.endsWith("in.wav")) {
      assert.notEqual(result.exitCode, 0);
      assert.match(stderr, /same as Input/);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const expected = volume.readFileSync("/control.pcm") as Buffer;
      assert.equal(expected.byteLength, 256);
      assert.deepEqual(volume.readFileSync("/first.pcm"), expected);
      assert.deepEqual(volume.readFileSync("/second.pcm"), expected);
    }
    assert.equal(volume.existsSync(`/${target}`), false);
    assert.deepEqual(volume.readFileSync("/in.wav"), input);
  });
}

it("routes tee protocol output through async destination checks before writing", () => {
  const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.of(0, 0.25)] });
  const writes: string[] = [];
  assert.equal(evalSyncFfmpeg(
    ["-y", "-i", "in.wav", "-c:a", "pcm_s16be", "-f", "s16be", "tee:first.pcm|second.pcm"],
    undefined, path => path === "in.wav" ? input : undefined,
    path => { writes.push(path); return true; }
  ), undefined);
  assert.deepEqual(writes, []);
});
