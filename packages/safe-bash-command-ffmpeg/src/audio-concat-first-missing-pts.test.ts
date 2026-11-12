import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 emits the untimed first segment before failing to advance.
for (const [first, second, status, expected] of [
  ["asetpts=NAN", "volume=-1", 183, [101, 102]],
  ["asetpts=NAN", "volume=-1,asetpts=NAN", 183, [101, 102]],
  ["anull", "volume=-1,asetpts=NAN", 0, [101, 102, -101, -102]],
  ["asetpts=NAN,asetpts=N/SR/TB", "volume=-1", 0, [101, 102, -101, -102]],
  ["atrim=end_sample=0", "volume=-1", 0, [-101, -102]],
  ["asetnsamples=n=1:p=0,asetpts=if(eq(N\\,0)\\,NAN\\,PTS)", "volume=-1", 0, [101, 102, -101, -102]],
  ["asetnsamples=n=1:p=0,asetpts=if(eq(N\\,1)\\,NAN\\,PTS)", "volume=-1", 183, [101, 102]]
] as const) {
  for (const simple of [false, true]) {
    for (const destination of ["pipe:1", "/out.pcm"]) {
      it(`concat first segment ${first}; second ${second} to ${destination} (simple=${simple})`, async () => {
        const input = Buffer.from([101, 0, 102, 0]);
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.pcm": "KEEP" });
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y",
            "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            ...(simple
              ? ["-af", `asplit[a][b];[a]${first}[x];[b]${second}[y];[x][y]concat=n=2:v=0:a=1`]
              : ["-filter_complex", `[0:a]${first}[x];[1:a]${second}[y];[x][y]concat=n=2:v=0:a=1`]),
            "-f", "s16le", destination],
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
        assert.equal(result.exitCode, status, stderr);
        const output = destination === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(destination) as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
        if (status !== 0) assert.ok(stderr.includes("Invalid data found when processing input"), stderr);
        else assert.equal(stderr, "");
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
