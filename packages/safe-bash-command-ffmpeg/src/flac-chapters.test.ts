import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const bytes = readFileSync(new URL("../../safe-bash-command-ffprobe/src/fixtures/chapters.flac", import.meta.url));
const chapters = "[CHAPTER]\nTIMEBASE=1/1000\nSTART=125\nEND=625\ntitle=Intro\n" +
  "[CHAPTER]\nTIMEBASE=1/1000\nSTART=625\nEND=1000\ntitle=Q and A\n";
it("exports named FLAC Vorbis-comment chapters in asynchronous and synchronous FFmetadata", async () => {
  const volume = Volume.fromJSON({ "/in.flac": bytes });
  const args = ["-v", "error", "-y", "-i", "/in.flac", "-f", "ffmetadata", "/out.txt"];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = volume.readFileSync("/out.txt", "utf8") as string;
  assert.ok(output.endsWith(chapters), output);
  assert.ok(output.includes("TITLE=Meeting\n"));
  assert.ok(!output.includes("CHAPTER001="));
  let written = false;
  assert.equal(evalSyncFfmpeg(args, undefined, () => bytes, (_path, data) => {
    written = true;
    assert.equal(new TextDecoder().decode(data), output);
    return true;
  }), "");
  assert.ok(written);
});
