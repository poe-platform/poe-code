import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const inputs = [
  [1000, 2000],
  [3000, 4000]
].map(channels => Buffer.from(encodeWav({ sampleRate: 8000,
  channels: channels.map(value => new Float64Array(512).fill(value / 32768)) })));

async function run(map: string) {
  const volume = Volume.fromJSON({ "/a.wav": inputs[0]!, "/b.wav": inputs[1]!, "/out.pcm": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
      `[0:a][1:a]join=map=${map}[o]`, "-map", "[o]", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/a.wav"), inputs[0]);
  assert.deepEqual(volume.readFileSync("/b.wav"), inputs[1]);
  return { result, stderr, bytes: volume.readFileSync("/out.pcm") as Buffer };
}

// Native FFmpeg 7.0.2 reads both ordinals with strtol(base=0), including a leading +.
for (const map of [
  "0.0-FL|1.1-FR",
  "0x0.0-FL|0x1.1-FR", "0X0.0-FL|0X1.1-FR",
  "0.0x0-FL|1.0x1-FR", "0.0X0-FL|1.0X1-FR",
  "+0.0-FL|+1.1-FR", "0.+0-FL|1.+1-FR",
  "00.0-FL|01.1-FR", "0.00-FL|1.01-FR",
  "0X0.+0X0-FL|+0X1.+0X1-FR",
  "0x0.FL-FL|+0x1.FR-FR",
  "0.08-FL|1.1-FR", "0.0x-FL|1.1-FR", "0.0b1-FL|1.1-FR"
]) {
  it(`joins native numeric input and channel ordinals: ${map}`, async () => {
    const { result, stderr, bytes } = await run(map);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(bytes.length, 512 * 2 * 2);
    for (let frame = 0; frame < 512; frame++) {
      assert.equal(bytes.readInt16LE(frame * 4), 1000, `left frame ${frame}`);
      assert.equal(bytes.readInt16LE(frame * 4 + 2), 4000, `right frame ${frame}`);
    }
  });
}

for (const map of [
  "0x2.0-FL|1.1-FR", "0.0x2-FL|1.1-FR",
  "0x.0-FL|1.1-FR", "0.+-FL|1.1-FR", "0xg.0-FL|1.1-FR",
  "08.0-FL|1.1-FR", "0x0.BOGUS-FL|1.1-FR",
  "-1.0-FL|1.1-FR", "0.-1-FL|1.1-FR",
  "0x0.0-FL|0x1.1-FL"
]) {
  it(`rejects invalid join indices without replacing output: ${map}`, async () => {
    const { result, stderr, bytes } = await run(map);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("join"), stderr);
    assert.equal(bytes.toString(), "KEEP");
  });
}
