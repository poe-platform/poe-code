import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [pattern, names] of [
  ["x%d_%d.wav", ["x0_0.wav", "x1_1.wav"]],
  ["x%02d_%d.wav", ["x00_0.wav", "x01_1.wav"]],
  ["x%%d%d_%02d.wav", ["x%d0_00.wav", "x%d1_01.wav"]],
  ["part%02d.wav", ["part00.wav", "part01.wav"]],
  ["p%%x%02d.wav", ["p%x00.wav", "p%x01.wav"]]
] as const) {
  const invalid = pattern.startsWith("x");
  it(`${invalid ? "rejects repeated fields before writing audio" : "preserves numbered and escaped-percent filenames"}: ${pattern}`, async () => {
    const volume = Volume.fromJSON({ [`/${names[0]}`]: "KEEP" });
    volume.writeFileSync("/ramp.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 24000 }, (_, i) => i / 32768)] }));
    const input = volume.readFileSync("/ramp.wav") as Buffer;
    const writes: string[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/ramp.wav", "-c", "copy", "-f", "segment",
        "-segment_list", "/parts.csv", `/${pattern}`],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) {
          writes.push(path);
          volume.writeFileSync(path, bytes);
        },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.deepEqual(volume.readFileSync("/ramp.wav"), input);
    if (invalid) {
      assert.equal(volume.statSync(`/${names[0]}`).size, 4);
      assert.equal(volume.readFileSync(`/${names[0]}`, "utf8"), "KEEP");
      assert.deepEqual(volume.readdirSync("/").filter(name => name !== "parts.csv"),
        ["ramp.wav", names[0]].sort());
      assert.deepEqual(writes.filter(path => path !== "/parts.csv"), []);
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("single numeric field"), stderr);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(volume.readFileSync("/parts.csv", "utf8"),
        `${names[0]},0.000000,2.048000\n${names[1]},2.048000,3.000000\n`);
      const pcm = names.flatMap(name => Array.from(
        parseWav(volume.readFileSync(`/${name}`) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!));
      assert.deepEqual(pcm, Array.from(parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!));
    }
  });
}
