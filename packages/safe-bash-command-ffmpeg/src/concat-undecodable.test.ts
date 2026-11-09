import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const firstBroken of [false, true]) {
  for (const xerror of [false, true]) {
    for (const broken of ["not a wav", "RIFF\u0000\u0000\u0000\u0000WAVE"]) {
      it(`concat retains prior audio for invalid input ${JSON.stringify(broken)}, first=${firstBroken}, xerror=${xerror}`, async () => {
        const volume = Volume.fromJSON({
          "/list.ffconcat": `${firstBroken ? "" : "file a.wav\n"}file broken.wav\nfile b.wav\n`,
          "/broken.wav": broken,
          "/out.bin": "keep"
        });
        const expected = Buffer.alloc(16000);
        for (let i = 0; i < 8000; i++) expected.writeInt16LE(1000 + i, i * 2);
        for (const [name, base] of [["a.wav", 1000], ["b.wav", -9000]] as const) {
          volume.writeFileSync(`/${name}`, encodeWav({ sampleRate: 8000,
            channels: [Float64Array.from({ length: 8000 }, (_, i) => (base + i) / 32768)] }));
        }
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", ...(xerror ? ["-xerror"] : []), "-f", "concat", "-safe", "0",
            "-i", "/list.ffconcat", "-c:a", "copy", "-f", "s16le", "/out.bin"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, firstBroken || xerror ? 1 : 0, stderr);
        assert.ok(stderr.length > 0, "invalid input must report an error");
        assert.deepEqual(volume.readFileSync("/out.bin"), firstBroken ? Buffer.from("keep") : expected);
      });
    }
  }
}
