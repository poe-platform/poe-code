import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [options, expected] of [
  ["channel_layout=FL+FL", "01004701fdfffdff47010100"],
  ["channel_layout=FL+FL:map=1.0-FL", "47010100fdfffdff01004701"],
  ["channel_layout=FR+FR", "01004701fdfffdff47010100"],
  ["channel_layout=2 channels (FR+FR)", "01004701fdfffdff47010100"],
  ["channel_layout=FL@left+FL@other", "01004701fdfffdff47010100"],
  ["channel_layout=FC+FC", "01004701fdfffdff47010100"],
  ["channel_layout=FC+FC:map=1.0-FC", "47010100fdfffdff01004701"],
  ["channel_layout=FR+FL", "01004701fdfffdff47010100"],
  ["channel_layout=FL+FL:map=0.0-FL|1.0-FL", undefined],
  ["channel_layout=FL+FL+FL", undefined]
] as const) {
  it(`routes repeated join speakers by output slot: ${options}`, async () => {
    const volume = Volume.fromJSON({
      "/0.pcm": Buffer.from("0100fdff4701", "hex"),
      "/1.pcm": Buffer.from("4701fdff0100", "hex"),
      "/out.pcm": "preserve"
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/0.pcm",
        "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/1.pcm", "-filter_complex",
        `[0:a][1:a]join=${options}[out]`, "-map", "[out]", "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    const bytes = volume.readFileSync("/out.pcm") as Buffer;
    if (expected === undefined) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("join"), stderr);
      assert.equal(bytes.toString(), "preserve");
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(bytes.toString("hex"), expected);
    }
  });
}
