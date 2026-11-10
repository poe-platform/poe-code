import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [option, expectedExitCode] of [["enable=1", 176], ["bogus=1", 8], ["", 0]] as const) {
    for (const existingOutput of [false, true]) {
      it(`channelsplit ${option || "control"} (${graph ? "graph" : "simple"}, ${existingOutput ? "existing" : "new"} output)`, async () => {
        const volume = Volume.fromJSON(existingOutput ? { "/out.raw": "keep" } : {});
        volume.writeFileSync("/in.raw", Buffer.from("6400c8009cff38ff", "hex"));
        const filter = `channelsplit=stereo:FL${option ? `:${option}` : ""}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-channel_layout", "stereo", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, expectedExitCode, stderr);
        if (expectedExitCode === 0) {
          assert.equal(stderr, "");
          assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), "64009cff");
        } else {
          assert.equal(stderr, `ffmpeg: channelsplit: unsupported option ${option.split("=")[0]}\n`);
          if (existingOutput) assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
          else assert.equal(volume.existsSync("/out.raw"), false);
        }
      });
    }
  }
}
