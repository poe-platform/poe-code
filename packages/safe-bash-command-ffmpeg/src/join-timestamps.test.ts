import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const join = "join=map=0.0-FL|1.1-FR";

for (const [graph, length, expectedFrames] of [
  [`[0:a]asetpts=PTS+4000[x];[x][1:a]${join},aselect='gte(t,0.5)'[o]`, 512, 512],
  [`[1:a]asetpts=PTS+4000[x];[0:a][x]${join},aselect='gte(t,0.5)'[o]`, 512, 0],
  [`[0:a][1:a]${join},aselect=not(t)[o]`, 512, 512],
  [`[0:a]asetpts=PTS+4000[x];[x][1:a]${join},aselect='gte(t,0.5)'[o]`, 1300, 1300],
  [`[0:a]asetpts=PTS+4000+N[x];[x][1:a]${join},aselect='gte(t,0.7)'[o]`, 1300, 276],
  [`[0:a]asetpts=PTS-4000[x];[x][1:a]${join},aselect='lt(t,0)'[o]`, 512, 512]
] as const) {
  it(`carries the first join input timestamps: ${graph} (${length} samples)`, async () => {
    const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
    for (const [path, values] of [["/a.wav", [1000, 2000]], ["/b.wav", [3000, 4000]]] as const) {
      volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
        channels: values.map(value => new Float64Array(length).fill(value / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/a.wav", "-i", "/b.wav",
        "-filter_complex", graph, "-map", "[o]", "-f", "s16le", "/out.pcm"],
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
    const bytes = volume.readFileSync("/out.pcm");
    assert.equal(bytes.length, expectedFrames * 4);
    const expected = Buffer.alloc(expectedFrames * 4);
    for (let frame = 0; frame < expectedFrames; frame++) {
      expected.writeInt16LE(1000, frame * 4);
      expected.writeInt16LE(4000, frame * 4 + 2);
    }
    assert.deepEqual(bytes, expected);
  });
}
