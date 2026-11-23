import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { allMediaAsts, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const flags of [[], ["-ar", "4000"], ["-ac", "1"]]) {
  it(`narrows decoded ALAC like native FFmpeg with ${flags.join(" ") || "no processing"}`, async () => {
    const pcm = Buffer.alloc(8200 * 2 * 3);
    for (let i = 0; i < 8200 * 2; i++) pcm.writeIntLE((i * 19937) % 16777216 - 8388608, i * 3, 3);
    const raw = allMediaAsts().find(plugin => plugin.id === "s24le")!;
    const input = serializeMp4(raw.parse(pcm, { sampleRate: 8000, channels: 2 }), { audioCodec: "alac" });
    const native = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", ...flags, "-f", "s16le", "pipe:1"], { input });
    assert.equal(native.status, 0, native.stderr.toString());
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/input.m4a", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/input.m4a", ...flags, "-f", "s16le", "/output"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(volume.readFileSync("/output"), native.stdout);
  });
}
