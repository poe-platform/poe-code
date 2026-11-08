import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const firstMissing of [false, true]) {
  for (const xerror of [false, true]) {
    for (const malformed of [false, true]) {
      it(`concat missing ${firstMissing ? "first" : "later"} file, xerror=${xerror}, malformed=${malformed}`, async () => {
        const volume = Volume.fromJSON({
          "/list.ffconcat": `${firstMissing ? "" : "file a.wav\n"}file missing.wav\nfile b.wav\n${malformed ? "unknown\n" : ""}`
        });
      for (const [name, base] of [["a.wav", 1000], ["b.wav", -9000]] as const) {
        volume.writeFileSync(`/${name}`, encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 8000 }, (_, i) => (base + i) / 32768)] }));
      }
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", ...(xerror ? ["-xerror"] : []), "-f", "concat", "-i", "/list.ffconcat", "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode === 0, !firstMissing && !xerror && !malformed, stderr);
      assert.ok(stderr.includes(malformed ? "unknown keyword" : "missing.wav"), stderr);
      assert.equal(volume.existsSync("/out.wav"), !firstMissing && !malformed);
      if (!firstMissing && !malformed) {
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.channelData[0]!.length, 8000);
        assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
          Array.from({ length: 8000 }, (_, i) => 1000 + i));
      }
    });
    }
  }
}
