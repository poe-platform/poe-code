import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseFlv } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [law, tag, prefix] of [["mulaw", 8, "84828486848a848e"], ["alaw", 7, "80ea80eb80e880e9"]] as const) {
  it(`preserves ${law} identity, bytes and decoded samples through FLV`, async () => {
    const volume = Volume.fromJSON({});
    const codes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    volume.writeFileSync("/codes.raw", codes);
    const run = async (args: string[]) => {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    };
    const input = ["-f", law, "-ar", "8000", "-ac", "1", "-i", "/codes.raw"];
    await run([...input, "-c:a", "copy", "-f", "flv", "/out.flv"]);
    const output = volume.readFileSync("/out.flv") as Buffer;
    assert.equal(output[24]! >>> 4, tag, "G.711 sound format without an AAC sequence header");
    assert.deepEqual(output.subarray(25, 281), codes, "tag contains unmodified G.711 codes");
    const track = parseFlv(output).tracks[0]!;
    const desc = track.codecDescriptions[0]!;
    assert.equal(desc.codecName, `pcm_${law}`);
    assert.equal(desc.sampleRate, 8000);
    assert.equal(desc.channels, 1);
    assert.equal(desc.bitsPerSample, 8);
    assert.deepEqual(Buffer.concat(track.samples.map(s => Buffer.from(s.data))), codes);
    assert.equal(track.duration / track.timescale, 256 / 8000);
    await run(["-i", "/out.flv", "-c:a", "copy", "-f", law, "/extracted.raw"]);
    assert.deepEqual(volume.readFileSync("/extracted.raw"), codes);
    await run([...input, "-c:a", "pcm_s16le", "-f", "s16le", "/direct.pcm"]);
    await run(["-i", "/out.flv", "-c:a", "pcm_s16le", "-f", "s16le", "/decoded.pcm"]);
    const decoded = volume.readFileSync("/decoded.pcm") as Buffer;
    assert.equal(decoded.subarray(0, 8).toString("hex"), prefix);
    assert.deepEqual(decoded, volume.readFileSync("/direct.pcm"));
  });
}
