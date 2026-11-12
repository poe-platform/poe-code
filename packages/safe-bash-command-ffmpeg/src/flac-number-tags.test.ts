import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { Volume } from "memfs";
import { parseAudio, writeAudioMetadata } from "@poe-code/audio-ast";
import { flacAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const base = readFileSync(new URL("./fixtures/trim-16.flac", import.meta.url));
const samples = flacAst().parse(base).tracks[0]!.decodedAudio!.channelData;

for (const [key, original, replacement] of [["track", "2/6", "4/6"], ["disc", "1/2", "2/2"]] as const) {
  for (const spelling of [key, `${key.toUpperCase()}NUMBER`, `${key}Number`]) {
    for (const value of [replacement, ""]) for (const sync of [false, true]) {
      it(`replaces FLAC ${spelling}=${value} (${sync ? "sync" : "async"})`, async () => {
        const input = writeAudioMetadata(parseAudio(base), { [key]: original, title: "Blue" });
        const volume = Volume.fromJSON({ "/input.flac": Buffer.from(input) });
        const args = ["-v", "error", "-i", "/input.flac", "-c:a", "copy",
          "-metadata", `${spelling}=${value}`, "-metadata", "title=Orange", "-f", "flac", sync ? "/output.flac" : "pipe:1"];
        let output: Uint8Array;
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          output = volume.readFileSync("/output.flac") as Buffer;
        } else {
          const chunks: Uint8Array[] = [];
          let diagnostic = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: { async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); } },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
            stderr: { async write(bytes: Uint8Array) { diagnostic += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, diagnostic);
          output = Buffer.concat(chunks);
        }
        const records = parseAudio(output).nodes.filter(node => node.type === "VORBIS_COMMENT")
          .flatMap(node => node.fields!.comments as string[]);
        assert.deepEqual(records.filter(record => !record.toLowerCase().startsWith("encoder=")).sort(),
          ["artist=Alice", "title=Orange", ...(value ? [`${key.toUpperCase()}NUMBER=${value}`] : [])].sort());
        assert.deepEqual(flacAst().parse(output).tracks[0]!.decodedAudio!.channelData, samples);
        assert.deepEqual(Buffer.from(parseAudio(output).nodes.find(node => node.type === "FRAMES")!.data),
          Buffer.from(parseAudio(input).nodes.find(node => node.type === "FRAMES")!.data));
      });
    }
  }
}
