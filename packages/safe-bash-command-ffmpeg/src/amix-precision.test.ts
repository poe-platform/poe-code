import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function mix(formats: string[], samples: number[][], output: string, graph = "[0:a][1:a]amix[o]") {
  const volume = new Volume();
  const args: string[] = ["-v", "error"];
  for (const [index, format] of formats.entries()) {
    const width = format === "s16le" ? 2 : format === "f32le" ? 4 : 8;
    const pcm = Buffer.alloc(samples[index]!.length * width);
    samples[index]!.forEach((value, sample) => {
      if (format === "s16le") pcm.writeInt16LE(value, sample * width);
      else if (format === "f32le") pcm.writeFloatLE(value, sample * width);
      else pcm.writeDoubleLE(value, sample * width);
    });
    volume.writeFileSync(`/${index}.pcm`, pcm);
    args.push("-f", format, "-ar", "8000", "-ac", "1", "-i", `/${index}.pcm`);
  }
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: [...args, "-filter_complex", graph, "-map", "[o]", "-f", output, "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(stdout);
}

for (const output of ["f64le", "f32le"]) {
  for (const delta of [0, 2 ** -31]) {
    it(`preserves double amix cancellation ${delta} before ${output} encoding`, async () => {
      const pcm = await mix(["f64le", "f64le"], [[0.5 + delta], [-0.5]], output,
        "[0:a][1:a]amix=duration=shortest[o]");
      assert.equal(output === "f64le" ? pcm.readDoubleLE() : pcm.readFloatLE(), delta / 2);
    });
  }
}

// Exact PCM output from native FFmpeg 7.0.2, including the dropout transition.
for (const [output, expected] of [
  ["f64le", "0000000000c0723f0000000000c892bf000000000070a03f0000000000aeb33f0000e2767aebb33f0000f6519079b73f00006e27b44dbdbf"],
  ["f32le", "0000963b004096bc0080033d00709d3dd45b9f3d83ccbb3da16deabd"]
] as const) {
  it(`matches native integer-input amix dropout precision for ${output}`, async () => {
    const pcm = await mix(["s16le", "s16le"],
      [[1001, -2003, 3005, 4007, 5099, 6009, -7501], [-701, 801, -901, 1031]], output);
    assert.equal(pcm.toString("hex"), expected);
  });
}

for (const first of ["f32le", "f64le"]) {
  it(`uses the first floating input's ${first} precision for mixed inputs`, async () => {
    const pcm = await mix([first, "f64le"], [[-0.5], [0.5 + 2 ** -31]], "f64le");
    assert.equal(pcm.readDoubleLE(), first === "f32le" ? 0 : 2 ** -32);
  });
}

it("retains float32 mixing selected by upstream aformat before double output", async () => {
  const pcm = await mix(["f64le", "f64le"], [[-0.5], [0.5 + 2 ** -31]], "f64le",
    "[0:a]aformat=sample_fmts=flt[a];[a][1:a]amix[o]");
  assert.equal(pcm.readDoubleLE(), 0);
});
