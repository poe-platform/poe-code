import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function runGainCommand(gain: string, expression: string | undefined, complex: boolean): Promise<Buffer> {
  const input = Buffer.alloc(32);
  for (let i = 0; i < 16; i++) input.writeInt16LE([2000, -3000, 4000, -5000][i % 4]!, i * 2);
  const volume = Volume.fromJSON({ "/in.raw": input });
  const filter = "asetnsamples=n=4:p=0,"
    + (expression === undefined ? "" : `asendcmd=c='0.001 aemphasis@eq ${gain} ${expression}',`)
    + `aemphasis@eq=${gain === "level_in" ? "level_in=0.5:" : ""}level_out=0.5`;
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = Buffer.concat(chunks);
  assert.equal(output.length, input.length);
  return output;
}

for (const complex of [false, true]) {
  const route = complex ? "graph" : "simple";
  for (const gain of ["level_in", "level_out"]) {
    for (const [expression, numeric] of [["isnan(0/0)", 1], ["isinf(1/0)", 1], ["if(isnan(0/0),2,3)", 2],
      ["default", 1], ["PI/4", Math.PI / 4],
      ["min", 0], ["max/64", 1], ["E/4", Math.E / 4], ["PHI/2", (1 + Math.sqrt(5)) / 4]] as const) {
      it(`applies scheduled aemphasis ${gain} ${expression} at the third frame (${route})`, async () => {
        const control = await runGainCommand(gain, undefined, complex);
        const expected = await runGainCommand(gain, String(numeric), complex);
        const output = await runGainCommand(gain, expression, complex);
        assert.deepEqual(expected.subarray(0, 16), control.subarray(0, 16));
        assert.notDeepEqual(expected.subarray(16), control.subarray(16));
        assert.deepEqual(output, expected);
        // Complete PCM from native FFmpeg 7.0.2, including the unchanged first two frames.
        if (gain === "level_out" && (expression === "default" || expression === "PI/4")) {
          assert.equal(output.toString("hex"), "4102bffef30046ff05fce4ffb30034ff"
            + (expression === "default" ? "85f822ff1c02b8fd24f99bfe880264fd" : "20fa52ffa80135fe9dfae8fefd01f4fd"));
        }
      });
    }
    for (const expression of ["90", "max+1", "min-1", "invalid", "1/0", "0/0", "sqrt(-1)", "if(isinf(1/0),65,1)"]) {
      it(`retains aemphasis ${gain} after rejected scheduled value ${expression} (${route})`, async () => {
        assert.deepEqual(await runGainCommand(gain, expression, complex), await runGainCommand(gain, undefined, complex));
      });
    }
  }
}
