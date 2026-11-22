import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseWav } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const format of ["wav", "s16le"]) {
    for (const mapping of [[], ["-map", "0:a:99?"], ["-map", "0"]]) {
      if (sync && mapping.length) continue;
      it(`${sync ? "sync" : "async"} ${format} selects audio from MP4 with mapping ${mapping.join(" ") || "automatic"}`, async () => {
        const input = createSyntheticMp4({ width: 16, height: 16, fps: 4, frameCount: 2, includeAudio: true });
        const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
        const explicitAll = mapping[1] === "0";
        const args = ["-v", "error", "-i", "/in.mp4", ...mapping,
          ...(explicitAll ? ["-c", "copy"] : []), "-f", format, "/out.data"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
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
          assert.equal(result.exitCode, explicitAll ? 234 : 0, stderr);
          if (explicitAll) {
            assert.match(stderr, /exactly one stream/);
            assert.equal(volume.readFileSync("/out.data").length, 0);
          }
        }
        assert.deepEqual(volume.readFileSync("/in.mp4"), Buffer.from(input));
        if (explicitAll) return;
        const output = volume.readFileSync("/out.data") as Buffer;
        assert.ok(output.length > 0);
        if (format === "wav") {
          const document = parseWav(output);
          assert.deepEqual(document.tracks.map(track => track.type), ["audio"]);
          assert.ok(document.durationSeconds > 0);
        } else {
          assert.equal(output.length % 2, 0);
        }
      });
    }
  }
}
