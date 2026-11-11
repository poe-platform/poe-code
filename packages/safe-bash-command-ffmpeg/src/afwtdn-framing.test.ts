import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({ sampleRate: 8000,
  channels: [Float64Array.from({ length: 1200 }, (_, i) => ((i * 13129) % 30001 - 15000) / 32768)] });
const denoise = "afwtdn=samples=512:levels=2:wavet=sym2:sigma=0.1";

async function run(filter: string, format: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", format, "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(output);
}

// Native FFmpeg 7.0.2, identical PCM16 WAV input and filter expressions.
for (const graph of [false, true]) {
  for (const prefix of ["", "asetnsamples=n=73:p=0,"]) {
    for (const [selection, bytes, sha256] of [
      [",aselect='eq(n,0)'", 1006, "f28bce7a436b850576aafa1cf32bf195e5db68c632b92b9f1b4a474575e80981"],
      [",aselect='eq(n,1)'", 1024, "1c0e9ff1d6225f57544e17ed962f2f928351a395b16316711c7c3c94ca5af140"],
      ["", 3054, "2f2ba9f7bee86dd971296640edace24e1665063b4b55e640804c503b7b4de795"]
    ] as const) {
      it(`emits native denoised PCM for ${prefix}${denoise}${selection} (graph=${graph})`, async () => {
        const output = await run(`${prefix}${denoise}${selection}`, "s16le", graph);
        assert.equal(output.length, bytes);
        assert.equal(createHash("sha256").update(output).digest("hex"), sha256);
      });
    }
  }

  for (const [filter, frames] of [
    [denoise, [[0, 503], [503, 512], [1015, 512]]],
    [`asetnsamples=n=73:p=0,asetpts=PTS+80,${denoise}`, [[80, 503], [583, 512], [1095, 512]]],
    [`asetnsamples=n=73:p=0,asetpts=2*PTS,${denoise}`, [[0, 503], [1014, 512], [2037, 512]]],
    ["afwtdn=samples=512:levels=12:sigma=0.1", [[0, 435], [435, 512], [947, 253]]],
    ["afwtdn=samples=777:levels=4:sigma=0.1", [[0, 492], [492, 777]]]
  ] as const) {
    it(`emits native frame timestamps and durations for ${filter} (graph=${graph})`, async () => {
      const output = await run(filter, "framecrc", graph);
      const rows = output.toString().split("\n").filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").slice(2, 4).map(Number));
      assert.deepEqual(rows, frames);
    });
  }
}
