import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Shell-visible statuses from FFmpeg 7.0.2-static.
for (const [options, status] of [
  ["ns=4:enable=0", 176],
  ["ns=0", 222],
  ["ns=4:c1=bad", 234],
  ["ns=4:o=bad", 234],
  ["ns=4:unknown=1", 8],
  ["ns=4", 0]
] as const) {
  for (const destination of ["pipe:1", "/out.pcm"]) {
    it(`acrossfade=${options} returns ${status} to ${destination}`, async () => {
      const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
      for (const [name, value] of [["a", 12000], ["b", -3000]] as const) {
        volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 44100,
          channels: [new Float64Array(8000).fill(value / 32768)] }));
      }
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
          `[0:a][1:a]acrossfade=${options}`, "-f", "s16le", destination],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (status !== 0) {
        assert.equal(Buffer.concat(stdout).length, 0);
        assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
      } else {
        const output = destination === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(destination) as Buffer;
        const expected = [...Array<number>(7996).fill(12000), 9000, 5250, 1500, -2250,
          ...Array<number>(7996).fill(-3000)];
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      }
      assert.equal(result.exitCode, status, stderr);
    });
  }
}
