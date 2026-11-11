import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 stereo PCM WAV: left [1000, -1000], right [2000, -2000].
const stereo = Buffer.from("UklGRk4AAABXQVZFZm10IBAAAAABAAIAQB8AAAB9AAAEABAATElTVBoAAABJTkZPSVNGVA0AAABMYXZmNjEuMS4xMDAAAGRhdGEIAAAA6APQBxj8MPg=", "base64");

for (const graph of [false, true]) {
  for (const [selection, exitCode] of [["channels=FC", 234], ["stereo:XX", 234], ["channels=FR", 0]] as const) {
    for (const existingOutput of [false, true]) {
      it(`channelsplit ${selection} returns native status (${graph ? "graph" : "simple"}, ${existingOutput ? "existing" : "new"} output)`, async () => {
        const volume = Volume.fromJSON(existingOutput ? { "/out.raw": "keep" } : {});
        volume.writeFileSync("/in.wav", stereo);
        const filter = `channelsplit=${selection}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        if (exitCode === 0) {
          assert.equal(stderr, "");
          assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), "d00730f8");
        } else {
          assert.ok(stderr.includes("channelsplit:"), stderr);
          if (existingOutput) assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
          else assert.equal(volume.existsSync("/out.raw"), false);
        }
      });
    }
  }
}
