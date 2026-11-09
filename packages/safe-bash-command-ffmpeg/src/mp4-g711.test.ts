import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const law of ["mulaw", "alaw"]) {
  it(`rejects ${law} copy to MP4 while preserving MOV and WAV`, async () => {
    const volume = Volume.fromJSON({});
    const codes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    volume.writeFileSync("/codes.raw", codes);
    const run = async (args: string[]) => {
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
      return { ...result, stderr };
    };
    const input = ["-f", law, "-ar", "8000", "-ac", "1", "-i", "/codes.raw"];
    for (const container of ["mov", "wav"]) {
      const copied = await run([...input, "-c:a", "copy", `/out.${container}`]);
      assert.equal(copied.exitCode, 0, copied.stderr);
      const extracted = await run(["-i", `/out.${container}`, "-c:a", "copy", "-f", law, `/extracted-${container}.raw`]);
      assert.equal(extracted.exitCode, 0, extracted.stderr);
      assert.deepEqual(volume.readFileSync(`/extracted-${container}.raw`), codes);
    }
    for (const source of [input, ["-i", "/out.mov"], ["-i", "/out.wav"]]) {
      for (const format of [[], ["-f", "mp4"]]) {
        const result = await run([...source, "-y", "-c:a", "copy", ...format, "/rejected.mp4"]);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes(`codec pcm_${law}`), result.stderr);
        assert.ok(result.stderr.includes("not currently supported in container mp4"), result.stderr);
        assert.ok(!volume.existsSync("/rejected.mp4") || volume.statSync("/rejected.mp4").size === 0);
      }
    }
  });
}
