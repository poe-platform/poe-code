import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reference samples at 1 kHz, in three-sample frames.
for (const complex of [false, true]) {
  for (const named of [false, true]) {
    for (const threshold of [undefined, "0", "0.5", "invalid", "-1", "none", "all", "all+1.5"]) {
      it(`silenceremove timed stop_threshold=${threshold} (complex=${complex}, named=${named})`, async () => {
        const input = Buffer.alloc(24);
        [0, 0, 2000, 2000, 0, 0, -4000, -4000, 0, 0, 6000, 0]
          .forEach((sample, i) => input.writeInt16LE(sample, i * 2));
        const volume = Volume.fromJSON({ "/in.pcm": input });
        const target = named ? "silenceremove@trim" : "silenceremove";
        const filter = `asetnsamples=n=3:p=0,${threshold === undefined ? "" :
          `asendcmd=c='0.003 ${target} stop_threshold ${threshold}',`}${target}=stop_periods=-1:window=0`;
        const chunks: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.pcm",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        if (threshold === undefined || threshold === "0" || threshold === "0.5" || threshold === "none" || threshold === "all+1.5") assert.equal(stderr, "");
        const output = Buffer.concat(chunks);
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          (threshold === "0.5" || threshold === "all+1.5") ? [0, 0, 2000] : [0, 0, 2000, 2000, -4000, -4000, 6000]);
      });
    }
  }
}

// Native FFmpeg 7.0.2 reference samples at 1 kHz, in four-sample frames.
for (const complex of [false, true]) {
  for (const named of [false, true]) {
    for (const [time, threshold] of [[undefined, "0.001"], ["0.004", "0.001"], ["0.008", "0.001"],
      ["0.004", "none"], ["0.008", "all+1"]]) {
      it(`silenceremove timed start_threshold=${threshold} at ${time} (complex=${complex}, named=${named})`, async () => {
        const input = Buffer.alloc(40);
        [0, 0, 100, 0, 200, 300, 0, 0, 0, 400, 500, 600, 0, 0, 0, 0, 700, 800, 0, 0]
          .forEach((sample, i) => input.writeInt16LE(sample, i * 2));
        const volume = Volume.fromJSON({ "/in.pcm": input });
        const target = named ? "silenceremove@trim" : "silenceremove";
        const filter = `asetnsamples=n=4:p=0,${time === undefined ? "" :
          `asendcmd=c='${time} ${target} start_threshold ${threshold}',`}${target}=start_periods=1:start_threshold=1:window=0`;
        const chunks: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.pcm",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        const output = Buffer.concat(chunks);
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          time === undefined ? [] : time === "0.004"
            ? [200, 300, 0, 0, 0, 400, 500, 600, 0, 0, 0, 0, 700, 800, 0, 0]
            : [400, 500, 600, 0, 0, 0, 0, 700, 800, 0, 0]);
      });
    }
  }
}
