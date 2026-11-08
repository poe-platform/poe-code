import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAudio } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/comments.flac", import.meta.url));
for (const sync of [false, true]) for (const flags of [[], ["-bitexact"], ["-fflags", "bitexact"], ["-fflags", "+bitexact"]]) {
  it(`FLAC copy muxer encoder ${JSON.stringify(flags)} (${sync ? "sync" : "async"})`, async () => {
    assert.equal(parseAudio(input).tags.encoder, undefined);
    const volume = Volume.fromJSON({ "/in.flac": input });
    const args = ["-v", "error", "-y", "-i", "/in.flac", ...(sync ? [] : ["-map", "0"]), "-c", "copy", ...flags, "/out.flac"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
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
      assert.equal(result.exitCode, 0, stderr);
    }
    const output = parseAudio(volume.readFileSync("/out.flac") as Buffer);
    if (flags.length) assert.equal(output.tags.encoder, undefined);
    else assert.ok(output.tags.encoder?.startsWith("Lavf"));
    const { encoder: ignoredEncoder, ...tags } = output.tags;
    assert.deepEqual(tags, { ...parseAudio(input).tags, artist: "Alice;Bob" });
    assert.deepEqual(output.nodes.find(node => node.type === "FRAMES")!.data,
      parseAudio(input).nodes.find(node => node.type === "FRAMES")!.data);
  });
}
