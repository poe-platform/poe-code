import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, probeMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const fixture = readFileSync(new URL("../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4", import.meta.url));
for (const sync of [false, true]) {
  for (const priming of [true, false]) {
    it(`excludes AAC priming from frame-limited presentation (${sync ? "sync" : "async"}, priming=${priming})`, async () => {
      const source = parseMp4(fixture);
      const audio = source.tracks.find(track => track.type === "audio")!;
      const input = priming ? fixture : serializeMp4({ ...source, tracks: [{ ...audio, editList: [] }] });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      const args = ["-y", "-i", "/in.mp4", "-vn", "-frames:a", "3", "-c", "copy", "/out.mp4"];
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
      const bytes = volume.readFileSync("/out.mp4") as Buffer;
      const output = parseMp4(bytes);
      assert.equal(output.tracks.length, 1);
      assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), audio.samples.slice(0, 3).map(sample => sample.data));
      const probe = probeMp4(bytes, { showPackets: true });
      assert.deepEqual(probe.packets!.map(packet => packet.pts), priming ? [-1024, 0, 1024] : [0, 1024, 2048]);
      assert.deepEqual(probe.packets!.map(packet => packet.duration), [1024, 1024, 1024]);
      assert.equal(probe.packets![0]!.side_data_list?.[0]?.skip_samples, priming ? 1024 : undefined);
      assert.equal(Number(probe.streams[0]!.duration), priming ? 0.256 : 0.384);
      assert.equal(output.durationSeconds, priming ? 0.256 : 0.384);
    });
  }
}
