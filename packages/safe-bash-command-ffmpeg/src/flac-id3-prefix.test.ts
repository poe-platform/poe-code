import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { parseAudio } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const name of ["base", "bare", "v3", "v4", "id3only"]) for (const sync of [false, true]) {
  it(`copies ${name} FLAC with leading ID3 (${sync ? "sync" : "async"})`, async () => {
    const bytes = new Uint8Array(readFileSync(new URL(`../../audio-ast/src/fixtures/id3-prefix-${name}.flac`, import.meta.url)));
    const fs = new MemoryFileSystem();
    await fs.writeFile("/no-extension", bytes);
    await fs.writeFile("/out.flac", new TextEncoder().encode("KEEP"));
    const args = ["-v", "error", "-y", "-i", "/no-extension", "-c", "copy", "/out.flac"];
    let output: Uint8Array | undefined;
    if (sync) assert.equal(evalSyncFfmpeg(args, undefined, () => bytes, (_path, data) => { output = data; return true; }), "");
    else {
      let diagnostic = "";
      const result = await createFfmpegCommand().execute({ args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(chunk: Uint8Array) { diagnostic += new TextDecoder().decode(chunk); } }
      } as never);
      assert.equal(result.exitCode, 0, diagnostic);
      output = await fs.readFile("/out.flac");
    }
    assert.ok(output);
    assert.equal(new TextDecoder().decode(output.subarray(0, 4)), "fLaC");
    const audio = parseAudio(output), original = parseAudio(bytes);
    assert.equal(audio.streams[0]?.samples, 1200);
    assert.deepEqual(audio.nodes.find(node => node.type === "FRAMES")?.data,
      original.nodes.find(node => node.type === "FRAMES")?.data);
    assert.equal(audio.tags.title, name === "id3only" ? "Field recording" : undefined);
    assert.equal(audio.tags.artist, name === "id3only" ? "Ada" : undefined);
    let pcm: Uint8Array | undefined;
    assert.equal(evalSyncFfmpeg(["-v", "error", "-y", "-i", "/out.flac", "-f", "s16le", "/out.raw"],
      undefined, () => output, (_path, data) => { pcm = data; return true; }), "");
    assert.ok(pcm);
    assert.equal(pcm.length, 2400);
    // Independently decoded by native FFmpeg 7.0.2 from the fixture and its remux.
    assert.equal(createHash("sha256").update(pcm).digest("hex"),
      "74857b85ff78523181e2f83a7dddac0ddacd4722d66e4bacf57b4eaf81f13c34");
  });
}
