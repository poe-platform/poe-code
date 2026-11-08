import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { nutAst, allMediaAsts } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`copies WAV PCM into NUT (${sync ? "sync" : "async"})`, async () => {
    const pcm = Uint8Array.from({ length: 4000 }, (_, i) => i % 256);
    const doc = allMediaAsts().find(plugin => plugin.id === "s16le")!.parse(pcm,
      { sampleRate: 8000, channels: 1, decodeAudio: false });
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/tone.wav", allMediaAsts().find(plugin => plugin.id === "wav")!.serialize(doc, { audioCodec: "copy" }));
    const args = ["-v", "error", "-y", "-i", "/tone.wav", "-c", "copy", "/out.nut"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
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
    const output = nutAst().parse(volume.readFileSync("/out.nut") as Buffer, { decodeAudio: false });
    assert.deepEqual(Buffer.concat(output.tracks[0]!.samples.map(sample => sample.data)), Buffer.from(pcm));
    assert.equal(output.tracks[0]!.codecDescriptions[0]!.codecName, "pcm_s16le");
    assert.equal(output.durationSeconds, 0.25);
  });
}
