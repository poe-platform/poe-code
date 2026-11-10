import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [layout, channels, input, left, right] of [
  ["quad", "4", "6400c8002c0190019cff38ffd4fe70fe", "b70049ff", "1b01e5fe"],
  ["5.1", "6", "6400c8002c019001f40158029cff38ffd4fe70fe0cfea8fd", "1401ecfe", "5a01a6fe"]
] as const) {
  for (const [selected, expected] of [["FL", left], ["FR", right]]) {
    for (const graph of [false, true]) {
      it(`downmixes ${layout} before channelsplit ${selected} (${graph ? "graph" : "simple"})`, async () => {
        const volume = new Volume();
        volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", channels,
            "-channel_layout", layout, "-i", "/in.raw", ...(graph
              ? ["-filter_complex", `[0:a]channelsplit=stereo:${selected}[out]`, "-map", "[out]"]
              : ["-af", `channelsplit=stereo:${selected}`]), "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      });
    }
  }
}
