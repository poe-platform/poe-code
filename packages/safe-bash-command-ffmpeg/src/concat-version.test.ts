import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const format of [undefined, "concat", "wav"]) {
  for (const header of ["", " ffconcat version 1.0", "\ufeffffconcat version 1.0", "ffconcat version 1.0", "ffconcat\tversion\t1.0", "ffconcat version 2.0", "ffconcat version", "ffconcat bogus 1.0"]) {
    for (const existingOutput of [false, true]) {
      it(`concat validates ${JSON.stringify(header)} with format ${format} and existing output ${existingOutput}`, async () => {
        const valid = format === "concat"
          ? ["", "ffconcat version 1.0", " ffconcat version 1.0", "\ufeffffconcat version 1.0", "ffconcat\tversion\t1.0"].includes(header)
          : format === undefined && header === "ffconcat version 1.0";
        const volume = Volume.fromJSON({ "/list.ffconcat": `${header}\nfile a.wav\nfile b.wav\n` });
        for (const [name, base] of [["a", 1000], ["b", -9000]] as const) {
          volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
            channels: [Float64Array.from({ length: 8000 }, (_, i) => (base + i) / 32768)] }));
        }
        if (existingOutput) volume.writeFileSync("/out.wav", "existing output");
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", ...(format ? ["-f", format] : []), "-i", "/list.ffconcat", "-c:a", "pcm_s16le", "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (valid) {
          assert.equal(result.exitCode, 0, stderr);
          const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
          assert.equal(audio.channelData[0]!.length, 16000);
          assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), [
            ...Array.from({ length: 8000 }, (_, i) => 1000 + i),
            ...Array.from({ length: 8000 }, (_, i) => -9000 + i)
          ]);
        } else {
          assert.notEqual(result.exitCode, 0);
          if (format === "concat") assert.ok(stderr.includes("Line 1: invalid version"), stderr);
          else if (format === undefined) assert.ok(stderr.includes("Unsupported input format"), stderr);
          if (existingOutput) assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing output");
          else assert.equal(volume.existsSync("/out.wav"), false);
        }
      });
    }
  }
}
