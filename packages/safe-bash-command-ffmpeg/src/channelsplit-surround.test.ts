import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [layout, input, filter, expected] of [
  ["quad", "6400c8002c0190019cff38ffd4fe70fe", "channelsplit=quad:BL", "2c01d4fe"],
  ["quad", "6400c8002c0190019cff38ffd4fe70fe", "channelsplit=0x33:BR", "900170fe"],
  ["5.1", "6400c8002c019001f40158029cff38ffd4fe70fe0cfea8fd",
    "channelmap=0|1|2|3|4|5:0x60f,channelsplit=0x60f:SL", "f4010cfe"],
  ["5.1", "6400c8002c019001f40158029cff38ffd4fe70fe0cfea8fd",
    "channelmap=0|1|2|3|4|5:0x60f,channelsplit=channel_layout=FL+FR+FC+LFE+SL+SR:channels=SR", "5802a8fd"],
  ["5.1", "6400c8002c019001f40158029cff38ffd4fe70fe0cfea8fd",
    "channelmap=0|1|2|3|4|5:0x60f,channelsplit=0x60f:SL,pan=mono|c0=SL", "f4010cfe"],
  ["5.1", "6400c8002c019001f40158029cff38ffd4fe70fe0cfea8fd", "channelsplit=5.1:BL", "f4010cfe"]
] as const) {
  for (const graph of [false, true]) {
    it(`selects matching surround speakers (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", layout === "quad" ? "4" : "6",
          "-channel_layout", layout, "-i", "/in.raw", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      assert.equal(result.exitCode, 0, stderr);
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    });
  }
}
