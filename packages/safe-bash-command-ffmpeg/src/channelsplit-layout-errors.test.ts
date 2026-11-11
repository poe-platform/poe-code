import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: negotiation failures return EINVAL and open an empty file output.
for (const layout of ["FL+LFE", "FL+FC", "BL+BR", "FL+FR"]) {
  for (const graph of [false, true]) {
    for (const output of ["pipe:1", "new", "existing"]) {
      it(`channelsplit negotiates ${layout} with native status (${graph ? "graph" : "simple"}, ${output})`, async () => {
        const volume = Volume.fromJSON(output === "existing" ? { "/out.raw": "keep" } : {});
        const samples = [1000, 12000, 2000, 13000, -4000, -14000, 8000, -16000];
        const input = Buffer.alloc(samples.length * 2);
        samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
        volume.writeFileSync("/in.raw", input);
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-channel_layout", layout, "-i", "/in.raw",
            ...(graph ? ["-filter_complex", "[0:a]channelsplit=stereo:FR[out]", "-map", "[out]"]
              : ["-af", "channelsplit=stereo:FR"]),
            "-f", "s16le", output === "pipe:1" ? output : "/out.raw"],
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
        const supported = layout === "FL+FR";
        assert.equal(result.exitCode, supported ? 0 : 234, stderr);
        const pcm = output === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, index) => pcm.readInt16LE(index * 2)),
          supported ? [12000, 13000, -14000, -16000] : []);
        if (supported) assert.equal(stderr, "");
        else assert.ok(stderr.includes("channelsplit: matching input channel layout required"), stderr);
        if (output !== "pipe:1") assert.equal(Buffer.concat(stdout).length, 0);
      });
    }
  }
}
