import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function render(filter: string, graph: boolean): Promise<Buffer> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 32 }, (_, i) => (100 + i) / 32768),
    Float64Array.from({ length: 32 }, (_, i) => (-200 - i) / 32768)
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

// Native FFmpeg 7.0.2: declined all/unknown commands preserve the control's PCM.
for (const graph of [false, true]) {
  for (const target of ["adelay", "adelay@d"]) {
    for (const command of ["", "all 1", "unknown 0"]) {
      it(`adelay preserves PCM after ${target} ${command || "control"} (${graph ? "graph" : "simple"})`, async () => {
        const filter = `asetnsamples=8:0,${command ? `asendcmd=c='0.002 ${target} ${command}',` : ""}adelay@d=3S|0S`;
        const output = await render(filter, graph);
        assert.equal(output.length, 35 * 4);
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "fcf6c76133847b177a2df71e8c7abfff32f1c8545fa96f4b973add70aa2949f5");
        assert.deepEqual([output.readInt16LE(16 * 4), output.readInt16LE(16 * 4 + 2)], [113, -216]);
        assert.deepEqual([output.readInt16LE(34 * 4), output.readInt16LE(34 * 4 + 2)], [131, 0]);
      });
    }
  }

  it(`adelay still processes delays after declined commands (${graph ? "graph" : "simple"})`, async () => {
    const update = "0.003 adelay@d delays 5S|0S";
    const expected = await render(`asetnsamples=8:0,asendcmd=c='${update}',adelay@d=3S|0S`, graph);
    const output = await render(`asetnsamples=8:0,asendcmd=c='0.001 adelay@d all 1;0.002 adelay@d unknown 0;${update}',adelay@d=3S|0S`, graph);
    assert.deepEqual(output, expected);
    assert.notDeepEqual(output, await render("asetnsamples=8:0,adelay@d=3S|0S", graph));
  });
}
