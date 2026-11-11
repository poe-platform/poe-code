import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function render(filter: string, graph: boolean): Promise<Buffer> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 29 }, (_, i) => (1 + i) / 32768),
    Float64Array.from({ length: 29 }, (_, i) => (-1 - i) / 32768)
  ] }, { bitsPerSample: 16 }));
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
    "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(stdout);
}

// Native FFmpeg 7.0.2 reference: a downstream sender updates the next frame.
for (const graph of [false, true]) {
  for (const before of [false, true]) {
    for (const named of [false, true]) {
      for (const missing of [false, true]) {
        for (const delay of [false, true]) {
          it(`asendcmd upstream=${!before} named=${named} missing=${missing} delay=${delay} graph=${graph}`, async () => {
            const name = delay ? "adelay" : "volume";
            const target = missing ? `${name}@missing` : named ? `${name}@target` : name;
            const sender = `asendcmd=c='0.001 ${target} ${delay ? "delays 0S|6S" : "volume 0"}'`;
            const receiver = `${name}@target=${delay ? "0S|3S" : "1"}`;
            const output = await render(`asetnsamples=n=8:p=0,${before ? `${sender},${receiver}` : `${receiver},${sender}`}`, graph);
            const boundary = before ? 8 : 16;
            const right = [0, 0, 0, ...Array.from({ length: 29 }, (_, i) => -i - 1)];
            if (!missing && delay) right.splice(boundary, 0, 0, 0, 0);
            const length = delay ? right.length : 29;
            assert.equal(output.length, length * 4);
            for (let i = 0; i < length; i++) {
              const muted = !delay && !missing && i >= boundary;
              assert.deepEqual([output.readInt16LE(i * 4), output.readInt16LE(i * 4 + 2)],
                [muted || i >= 29 ? 0 : i + 1, delay ? right[i] : muted ? 0 : -i - 1], `pair ${i}`);
            }
          });
        }
      }
    }
  }
}

for (const graph of [false, true]) {
  it(`asendcmd delivers a generic command only to the first receiver (graph=${graph})`, async () => {
    const output = await render("asetnsamples=n=8:p=0,volume@first=1,asendcmd=c='0.001 volume volume 0.5',volume@second=2", graph);
    for (let i = 0; i < 29; i++) {
      const value = (i + 1) * (i < 16 ? 2 : 1);
      assert.deepEqual([output.readInt16LE(i * 4), output.readInt16LE(i * 4 + 2)], [value, -value]);
    }
  });
}
