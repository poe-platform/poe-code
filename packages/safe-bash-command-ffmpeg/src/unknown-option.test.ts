import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const position of ["before input", "before output", "after output", "valid"]) {
  it(`rejects unknown options without writes: ${position}`, async () => {
    const samples = Float64Array.from({ length: 800 }, (_, i) => (i - 400) / 32768);
    const input = encodeWav({ sampleRate: 8000, channels: [samples] });
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    const unknown = ["-a_not_real_option", "1"];
    const args = ["-v", "error", "-y",
      ...(position === "before input" ? unknown : []), "-i", "/in.wav",
      ...(position === "before output" ? unknown : []), "/out.wav",
      ...(position === "after output" ? unknown : [])];
    if (position !== "valid") {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
      assert.deepEqual(volume.readdirSync("/"), ["in.wav"]);
    }
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
    if (position === "valid") {
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.deepEqual(Array.from(audio.channelData[0]!), Array.from(samples));
    } else {
      assert.equal(result.exitCode, 8, stderr);
      assert.ok(stderr.includes("Unrecognized option 'a_not_real_option'"), stderr);
      assert.deepEqual(volume.readdirSync("/"), ["in.wav"]);
    }
    assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
  });
}
