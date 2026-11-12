import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [source, option, channels] of [
  ["sine", "samples_per_frame", 1],
  ["anullsrc", "n", 2],
  ["anullsrc", "nb_samples", 2]
] as const) {
  for (const size of [undefined, 400, 700]) {
    for (const frames of [1, 2, 6, undefined]) {
      it(`limits ${source} ${option}=${size ?? "default"} to ${frames ?? "all"} audio frames`, async () => {
        const volume = Volume.fromJSON({});
        const stdout: Uint8Array[] = [];
        const stderr: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "lavfi", "-i",
            `${source}=r=8000:d=0.25${size === undefined ? "" : `:${option}=${size}`}`,
            "-c:a", "pcm_s16le", ...(frames === undefined ? [] : ["-frames:a", String(frames)]), "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
        assert.equal(Buffer.concat(stderr).length, 0);
        const bytes = Buffer.concat(stdout);
        assert.equal(bytes.length, Math.min(2000, (size ?? 1024) * (frames ?? Infinity)) * channels * 2);
        if (source === "anullsrc") assert.ok(bytes.every(byte => byte === 0));
        else assert.ok(bytes.some(byte => byte !== 0));
      });
    }
  }
}

for (const [source, option, format, byteCount] of [
  ["sine", "samples_per_frame", "s16le", 800],
  ["anullsrc", "n", "u8", 800]
] as const) {
  it(`copies the requested ${source} PCM frame without losing packet data`, async () => {
    const volume = Volume.fromJSON({});
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "lavfi", "-i", `${source}=r=8000:d=0.25:${option}=400`,
        "-c:a", "copy", "-frames:a", "1", "-f", format, "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    assert.equal(Buffer.concat(stderr).length, 0);
    const bytes = Buffer.concat(stdout);
    assert.equal(bytes.length, byteCount);
    if (source === "anullsrc") assert.ok(bytes.every(byte => byte === 128));
    else assert.ok(bytes.some(byte => byte !== 0));
  });
}
