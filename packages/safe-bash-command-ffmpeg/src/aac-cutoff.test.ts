import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, probeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";


// Native FFmpeg sine=frequency=730:sample_rate=48000:duration=1, AAC,
// followed by -c copy -avoid_negative_ts make_zero.
const fixture = readFileSync(new URL("./fixtures/aac-cutoff.m4a", import.meta.url));
for (const sync of [false, true]) {
  for (const inputOption of [false, true]) {
    for (const cutoff of [undefined, "0.31", "0.32", "0"]) {
      it(`preserves whole AAC packets at ${cutoff ?? "unrestricted"} cutoff (${sync ? "sync" : "async"}, input=${inputOption})`, async () => {
        const audio = parseMp4(fixture).tracks[0]!;
        const volume = Volume.fromJSON({ "/in.m4a": fixture });
        const duration = cutoff === undefined ? [] : ["-t", cutoff];
        const args = ["-y", ...(inputOption ? duration : []), "-i", "/in.m4a",
          ...(!inputOption ? duration : []), "-c", "copy", "/out.m4a"];
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
        const bytes = volume.readFileSync("/out.m4a") as Buffer;
        const expected = audio.samples.filter(sample => cutoff === undefined || sample.pts < Number(cutoff) * audio.timescale);
        const output = parseMp4(bytes);
        assert.deepEqual(output.tracks[0]?.samples.map(sample => sample.data) ?? [], expected.map(sample => sample.data));
        const probe = probeMp4(bytes, { showPackets: true });
        assert.deepEqual(probe.packets?.map(packet => [packet.pts, packet.duration]) ?? [],
          expected.map(sample => [sample.pts, sample.duration]));
        if (cutoff === "0.31" || cutoff === "0.32") {
          assert.equal(expected.length, 15);
          assert.equal(output.durationSeconds, 0.32);
        }
      });
    }
  }
}
