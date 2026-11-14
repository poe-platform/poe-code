import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage, type RgbaImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import { createIccConversion } from "./icc-conversion.js";

// Owned D50-adapted RGB matrix profile; expected samples follow ICC equations.
const base = readFileSync(new URL("./fixtures/icc/para2-boundary.icc", import.meta.url));
const endpoint = readFileSync(new URL("./fixtures/icc/para2-endpoint.icc", import.meta.url));
const srgb = readFileSync(new URL("./fixtures/icc/srgb.icc", import.meta.url));
function profile(kind: number, parameters: number[]): Uint8Array {
  const start = (base.length + 3) & ~3;
  const bytes = new Uint8Array(start + 12 + parameters.length * 4);
  bytes.set(base);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  bytes.set(new TextEncoder().encode("para"), start);
  view.setUint16(start + 8, kind);
  parameters.forEach((value, i) => view.setInt32(start + 12 + i * 4, Math.round(value * 65536)));
  for (let i = 0; i < view.getUint32(128); i++) {
    const at = 132 + i * 12;
    if (["rTRC", "gTRC", "bTRC"].includes(new TextDecoder().decode(bytes.subarray(at, at + 4)))) {
      view.setUint32(at + 4, start);
      view.setUint32(at + 8, bytes.length - start);
    }
  }
  return bytes;
}
const linear = profile(0, [1]);
function convert(source: Uint8Array, destination: Uint8Array, samples: number[]) {
  const input: RgbaImage = {
    width: samples.length, height: 1, hasAlpha: true, space: "srgb", channels: 4,
    format: "raw", depth: "uchar", density: 72,
    data: new Uint8Array(samples.length * 4),
    evaluateSamples: Float64Array.from(samples.flatMap(x => [x * 255, x * 255, x * 255, 18700 / 257])),
  };
  const original = input.evaluateSamples!.slice();
  const conversion = createIccConversion(source, destination, "relative")!;
  const steps = conversion.apply(input);
  let step = steps.next();
  try { while (!step.done) step = steps.next(); } finally { conversion.close(); }
  expect(input.evaluateSamples).toEqual(original);
  for (let i = 3; i < step.value.data.length; i += 4) {
    expect(step.value.data[i]).toBe(73);
    expect(step.value.data16![i]).toBe(18700);
  }
  return step.value;
}

it("retains the ICC type-2 black offset at exactly a*x+b=0", () => {
  const image = convert(base, srgb, [0]);
  expect([...image.data.slice(0, 3)]).toEqual([39, 39, 39]);
});

for (const boundary of [0, 0.5, 1]) {
  it(`keeps type-2 offsets below, at and above boundary ${boundary}`, () => {
    const samples = [Math.max(0, boundary - 1 / 256), boundary, Math.min(1, boundary + 1 / 256)];
    const result = convert(boundary === 1 ? endpoint : profile(2, [2, 1, -boundary, 0.125]), linear, samples);
    samples.forEach((x, i) => {
      const expected = Math.max(0, x - boundary) ** 2 + 0.125;
      for (let channel = 0; channel < 3; channel++) {
        expect(result.evaluateSamples![i * 4 + channel]! / 255).toBeCloseTo(expected, 5);
        expect(Math.abs(result.data16![i * 4 + channel]! - Math.round(expected * 65535))).toBeLessThanOrEqual(1);
      }
    });
  });
}

it("keeps the inverse type-2 boundary at -b/a when Y equals c", () => {
  const samples = [0.125 - 1 / 256, 0.125, 0.125 + 1 / 256];
  const result = convert(linear, profile(2, [2, 1, -0.5, 0.125]), samples);
  samples.forEach((y, i) => {
    const expected = y < 0.125 ? 0.5 : Math.sqrt(y - 0.125) + 0.5;
    expect(result.evaluateSamples![i * 4]! / 255).toBeCloseTo(expected, 5);
  });
});

it("preserves the other four ICC parametric curve equations", () => {
  const cases: [number, number[], (x: number) => number][] = [
    [0, [2], x => x ** 2],
    [1, [2, 1, -0.5], x => Math.max(0, x - 0.5) ** 2],
    [3, [2, 1, 0, 0.5, 0.5], x => x < 0.5 ? x * 0.5 : x ** 2],
    [4, [2, 1, 0, 0.5, 0.5, 0.125, 0.125], x => (x < 0.5 ? x * 0.5 : x ** 2) + 0.125],
  ];
  for (const [kind, parameters, equation] of cases) {
    const samples = [0, 0.25, 0.5 - 1 / 256, 0.5, 0.5 + 1 / 256, 1];
    const result = convert(profile(kind, parameters), linear, samples);
    samples.forEach((x, i) => expect(result.evaluateSamples![i * 4]! / 255).toBeCloseTo(equation(x), 5));
  }
});

for (const mode of ["buffered", "sync", "retained", "command"]) {
  it(`preserves the type-2 offset through the ${mode} image command`, async () => {
    const files = new Map<string, Uint8Array>([
      ["input.ppm", Buffer.from("P6\n1 1\n255\n\0\0\0")],
      ["source.icc", base], ["srgb.icc", srgb],
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
    const args = ["input.ppm", "-profile", "source.icc", "-profile", "srgb.icc", "output.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    const image = decodeImage(mode === "buffered" || mode === "sync" ? files.get("output.png")! : await filesystem.readFile("/output.png"));
    expect([...image.data]).toEqual([39, 39, 39, 255]);
    expect(image.icc).toEqual(new Uint8Array(srgb));
  });
}
