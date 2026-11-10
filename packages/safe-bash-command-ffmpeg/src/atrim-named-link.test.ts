import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [filter, exitCode] of [
  ["atrim=end_sample=8[tmp];[tmp]atrim=start_sample=3", 0],
  ["atrim=end_sample=8,atrim=start_sample=3", 0],
  ["[tmp]atrim=start_sample=3;atrim=end_sample=8[tmp]", 0],
  ["atrim=end_sample=8[tmp];[tmp]atrim=start_sample=invalid", 234]
] as const) {
  it(`follows the audio path in ${filter}`, async () => {
    const input = Buffer.alloc(32);
    for (let i = 0; i < 16; i++) input.writeInt16LE(i + 1, i * 2);
    const volume = Volume.fromJSON({ "/in.raw": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", filter, "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    if (exitCode !== 0) {
      assert.equal(volume.existsSync("/out.raw"), false);
      return;
    }
    assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(6, 16));
  });
}
