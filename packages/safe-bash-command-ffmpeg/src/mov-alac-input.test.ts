import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/caf-alac-copy.mov", import.meta.url));

it("decodes native ALAC MOV to exact PCM and preserves stream-copy packets", async () => {
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  volume.writeFileSync("/input.mov", input);
  const run = async (args: string[]) => {
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", ...args], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
  };
  await run(["-i", "/input.mov", "-c:a", "copy", "/copy.mov"]);
  for (const bytes of [input, volume.readFileSync("/copy.mov") as Buffer]) {
    const native = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"], { input: bytes });
    assert.equal(native.status, 0, native.stderr.toString());
    assert.equal(native.stdout.length, 32800);
    assert.equal(createHash("sha256").update(native.stdout).digest("hex"),
      "50d5595b384041baf4e0d17bef38434d327019e750cd522c87b3cf80a6fc41bf");
  }
  for (const source of ["/input.mov", "/copy.mov"]) {
    await run(["-i", source, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"]);
    const output = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, 32800);
    assert.equal(output.subarray(0, 12).toString("hex"), "00006f0001006f0002006f00");
    assert.equal(createHash("sha256").update(output).digest("hex"),
      "50d5595b384041baf4e0d17bef38434d327019e750cd522c87b3cf80a6fc41bf");
  }
});
