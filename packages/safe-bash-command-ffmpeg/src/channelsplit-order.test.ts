import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [mapping, exitCode] of [
  ["channelmap=0|1:FR+FL", 234],
  ["channelmap=0|1:FL+FR", 0],
  ["channelmap=0|1:2C", 0],
  ["channelmap=0|1:FR+FL,channelmap=0|1:stereo", 0]
] as const) {
  for (const complex of [false, true]) {
    it(`channelsplit negotiates channel order (${complex ? "graph" : "simple"}): ${mapping}`, async () => {
      const volume = new Volume();
      volume.writeFileSync("/in.raw", Buffer.from("64009cffc80038ff", "hex"));
      const filter = `${mapping},channelsplit=channel_layout=stereo:channels=FL`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), exitCode === 0 ? "6400c800" : "");
      if (exitCode !== 0) assert.match(stderr, /channelsplit: unsupported input channel order FR\+FL/);
    });
  }
}
