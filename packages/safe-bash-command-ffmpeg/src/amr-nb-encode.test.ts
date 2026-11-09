import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/amr-nb-encode.wav", import.meta.url));
// Native FFmpeg 7.0.2: -i amr-nb-encode.wav -c:a libopencore_amrnb -b:a 12.2k out.amr
const reference = readFileSync(new URL("./fixtures/amr-nb-encode.amr", import.meta.url));
for (const sync of [false, true]) {
  for (const extension of ["3gp", "amr"]) {
    for (const invalid of [undefined, "rate", "channels"] as const) {
      it(`encodes AMR-NB to ${extension} (${sync ? "sync" : "async"}, ${invalid ?? "valid"})`, async () => {
        const output = `/out.${extension}`;
        const volume = Volume.fromJSON({ "/in.wav": input, [output]: "KEEP" });
        const args = ["-y", "-v", "error", "-i", "/in.wav", "-c:a", "libopencore_amrnb", "-b:a", "12.2k",
          ...(invalid === "rate" ? ["-ar", "16000"] : invalid === "channels" ? ["-ac", "2"] : []), output];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), invalid ? undefined : "");
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
          assert.equal(result.exitCode, invalid ? 1 : 0, stderr);
          if (invalid) assert.match(stderr, /AMR/);
        }
        const bytes = volume.readFileSync(output) as Buffer;
        if (invalid) { assert.equal(bytes.toString(), "KEEP"); return; }
        if (extension === "amr") assert.deepEqual(bytes, reference);
        else {
          const doc = parseMp4(bytes);
          const track = doc.tracks[0]!;
          assert.equal(doc.majorBrand, "3gp4");
          assert.equal(track.codecDescriptions[0]!.codecName, "amr_nb");
          assert.equal(track.codecDescriptions[0]!.sampleRate, 8000);
          assert.equal(track.codecDescriptions[0]!.channels, 1);
          assert.equal(track.samples.length, 7);
          assert.deepEqual(track.samples.map(sample => sample.duration), [160, 160, 160, 160, 160, 160, 50]);
          assert.equal(track.editList?.[0]?.mediaTime, 50);
          assert.deepEqual(Buffer.concat(track.samples.map(sample => sample.data)), reference.subarray(6));
        }
      });
    }
  }
}
