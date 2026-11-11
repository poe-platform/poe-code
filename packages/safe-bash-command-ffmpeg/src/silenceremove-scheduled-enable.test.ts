import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 100, 0, 200, 300, 0, 0, 0, 400, 500, 600, 0, 0, 0, 0, 700, 800, 0, 0];
const trim = "silenceremove@s=window=0:stop_periods=-1";

for (const graph of [false, true]) {
  for (const channels of [1, 2]) {
    it(`scheduled silence removal bypass matches native PCM (graph=${graph}, channels=${channels})`, async () => {
      // Native FFmpeg 7.0.2, 1 kHz WAV, four-sample frames.
      const expected = [0, 0, 100, 200, 300, 0, 0, 0, 400, 500, 600, 0, 0, 0, 0, 700, 800, 0, 0];
      assert.deepEqual(await run(`asendcmd=c='0.004 silenceremove@s enable 0',${trim}`, graph, channels),
        expected.flatMap(sample => Array(channels).fill(sample)));
    });
  }

  for (const [commands, enable] of [
    ["0.004 silenceremove@s enable 0", "lt(n,1)"],
    ["0.0041 silenceremove@s enable 0", "lt(n,2)"],
    ["0.004 silenceremove enable 0;0.012 silenceremove enable 1", "lt(n,1)+gte(n,3)"],
    ["0.004 silenceremove@s enable lt(n,1)+gte(t,0.012)", "lt(n,1)+gte(t,0.012)"],
    ["0.004 silenceremove@s enable 0;0.008 silenceremove@s enable invalid", "lt(n,1)"],
    ["0.004 silenceremove@missing enable 0", "1"],
    ["0.020 silenceremove@s enable 0", "1"]
  ]) {
    it(`scheduled enable ${commands} preserves frame semantics (graph=${graph})`, async () => {
      assert.deepEqual(await run(`asendcmd=c='${commands}',${trim}`, graph),
        await run(`${trim}:enable='${enable}'`, graph));
    });
  }

  for (const enable of ["PI", "E", "PHI"]) {
    it(`scheduled enable=${enable} replaces a bypass (graph=${graph})`, async () => {
      assert.deepEqual(await run(`asendcmd=c='0.004 silenceremove@s enable ${enable}',${trim}:enable=0`, graph),
        await run(`${trim}:enable='gte(n,1)'`, graph));
    });
  }

  it(`scheduled enable replaces an initial bypass (graph=${graph})`, async () => {
    assert.deepEqual(await run(`asendcmd=c='0.004 silenceremove@s enable 1',${trim}:enable=0`, graph),
      await run(`${trim}:enable='gte(n,1)'`, graph));
  });

  it(`scheduled enable and threshold updates remain independent (graph=${graph})`, async () => {
    assert.deepEqual(await run(`asendcmd=c='0.004 silenceremove@s enable 0;0.008 silenceremove@s stop_threshold 0.5;0.012 silenceremove@s enable 1',${trim}`, graph),
      await run(`asendcmd=c='0.008 silenceremove@s stop_threshold 0.5',${trim}:enable='lt(n,1)+gte(n,3)'`, graph));
  });

  it(`replacing enable starts fresh expression registers (graph=${graph})`, async () => {
    const enable = "gte(st(0,ld(0)+1),3)";
    assert.deepEqual(await run(`asendcmd=c='0.004 silenceremove@s enable ${enable}',${trim}:enable='${enable}'`, graph),
      await run(`${trim}:enable='gte(n,3)'`, graph));
  });

  it(`rejected enable retains expression registers (graph=${graph})`, async () => {
    assert.deepEqual(await run(`asendcmd=c='0.004 silenceremove@s enable invalid',${trim}:enable='gte(st(0,ld(0)+1),3)'`, graph),
      await run(`${trim}:enable='gte(n,2)'`, graph));
  });

  it(`scheduled enable selects the named instance (graph=${graph})`, async () => {
    assert.deepEqual(await run(`asendcmd=c='0.004 silenceremove@s enable 0',silenceremove@other,${trim}`, graph),
      await run(`silenceremove@other,${trim}:enable='lt(n,1)'`, graph));
  });
}

async function run(filter: string, graph: boolean, channels = 1): Promise<number[]> {
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 1000,
    channels: Array.from({ length: channels }, () => Float64Array.from(samples, sample => sample / 32768))
  })) });
  const chain = `asetnsamples=4:0,${filter}`;
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]), "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = Buffer.concat(chunks);
  return Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2));
}
