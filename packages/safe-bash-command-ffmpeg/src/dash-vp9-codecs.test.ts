import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

it("copies VP9 to DASH with the full native codec string", async () => {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/vp9.webm", readFileSync(new URL("../../mp4-ast/src/fixtures/dash-vp9-codec.webm", import.meta.url)));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/vp9.webm", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", "/out.mpd"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
      async rename(from: string, to: string) { volume.renameSync(from, to); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.ok(volume.readFileSync("/out.mpd", "utf8").includes('codecs="vp09.00.10.08"'));
});
