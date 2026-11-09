import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const directive of ["inpoint", "outpoint", "duration"]) {
  for (const value of [".5", "-.5", ".5s", ".5ms", ".5us", "0.5"]) {
    for (const existingOutput of [false, true]) {
      it(`concat ${directive} ${value} requires an integer part with existing output ${existingOutput}`, async () => {
        const volume = Volume.fromJSON({
          "/list.ffconcat": `ffconcat version 1.0\nfile a.wav\n${directive} ${value}\n`
        });
        volume.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 8000 }, (_, i) => i / 32768)] }));
        if (existingOutput) volume.writeFileSync("/out.pcm", "KEEP");
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "concat", "-i", "/list.ffconcat", "-c", "copy", "-f", "s16le", "/out.pcm"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (value !== "0.5") {
          assert.notEqual(result.exitCode, 0, stderr);
          assert.ok(stderr.includes(`Line 3: invalid ${directive} '${value}'`), stderr);
          if (existingOutput) assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
          else assert.equal(volume.existsSync("/out.pcm"), false);
        } else {
          assert.equal(result.exitCode, 0, stderr);
          const start = directive === "inpoint" ? 4000 : 0;
          const end = directive === "outpoint" ? 4096 : 8000;
          const expected = Buffer.alloc((end - start) * 2);
          for (let frame = start; frame < end; frame++) expected.writeInt16LE(frame, (frame - start) * 2);
          assert.deepEqual(volume.readFileSync("/out.pcm"), expected);
        }
      });
    }
  }
}
