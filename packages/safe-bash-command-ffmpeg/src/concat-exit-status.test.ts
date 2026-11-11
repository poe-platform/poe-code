import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 12 }, (_, i) => (i + 1) * 1000);
const input = Buffer.from(encodeWav({
  sampleRate: 8000, channels: [Float64Array.from(samples, sample => sample / 32768)]
}));

// Shell-visible statuses from native FFmpeg 7.0.2-static.
for (const [filter, status] of [
  ["concat=v=0:a=1:foo=1", 8],
  ["concat=v=0:a=1:enable=1", 176],
  ["concat=v=0:a=1:enable=0", 176],
  ["concat=n=0:v=0:a=1", 222],
  ["concat=n=-1:v=0:a=1", 222],
  ["concat=n=2147483648:v=0:a=1", 222],
  ["concat=v=-1:a=1", 222],
  ["concat=v=2147483648:a=1", 222],
  ["concat=v=0:a=-1", 222],
  ["concat=v=0:a=2147483648", 222],
  ["concat=n=0:n=2:v=0:a=1", 222],
  ["concat=0:0:1", 222],
  ["concat@joined=n=0:v=0:a=1", 222],
  ["concat=v=0:a=1", 0]
] as const) {
  for (const destination of ["pipe:1", "/out.pcm"]) {
    it(`${filter} returns ${status} to ${destination}`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": input, "/out.pcm": "KEEP" });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", "-filter_complex",
          `[0:a][0:a]${filter}[o]`, "-map", "[o]", "-f", "s16le", destination],
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
        assert.notEqual(stderr, "");
      } else {
        const output = destination === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(destination) as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          [...samples, ...samples]);
        assert.equal(stderr, "");
      }
      assert.deepEqual(volume.readFileSync("/in.wav"), input);
      assert.equal(result.exitCode, status, stderr);
    });
  }
}
