import assert from "node:assert/strict";
import { it } from "node:test";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { deflicker } from "./deflicker.js";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const fixture = Buffer.from([36, 40, 44, 192, 44, 40, 36, 32, 30].flatMap(v => [v, v + 4, v + 8, v + 12]));

async function run(filter: string, input = fixture, format = "gray", size = "2x2", graph = false) {
  const volume = Volume.fromJSON({ "/in": input, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "info", "-y", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
      "-framerate", "4", "-i", "/in", ...(graph ? ["-filter_complex", `[0:v]${filter}[o]`, "-map", "[o]"] : ["-vf", filter]), "-fps_mode", "passthrough",
      "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out") as Buffer };
}


for (const graph of [false, true]) for (const [filter, hex] of [
  ["null", fixture.toString("hex")],
  ["deflicker=size=3", "272b3034555d666e575f676f5f616264282c2f3324282b2f2124282c1e22262a1e22262a"],
  ["deflicker=s=3:m=median", "272b30342b2f3438aebecddd30313233282c2f3324282b2f2024272b1e2225291e22262a"],
  ["deflicker=s=3:bypass=1,metadata=print", fixture.toString("hex")]
]) {
  it(`matches native FFmpeg bytes and timestamps for ${filter} (graph=${graph})`, async () => {
    const result = await run(`${filter},showinfo`, fixture, "gray", "2x2", graph);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), hex);
    assert.deepEqual([...result.stderr.split("\n").filter(line => line.includes("showinfo")).join("\n").matchAll(/pts:\s*(\d+)/g)].map(m => Number(m[1])), [0,1,2,3,4,5,6,7,8]);
    if (filter!.includes("bypass")) {
      const luminance = ["42.000000", "46.000000", "50.000000", "198.000000", "50.000000", "46.000000", "42.000000", "38.000000", "36.000000"];
      const adjusted = ["46.000000", "98.000000", "99.333336", "98.000000", "46.000000", "42.000000", "38.666668", "36.666668", "36.000000"];
      const relative = ["0.095238", "1.130435", "0.986667", "-0.505051", "-0.080000", "-0.086957", "-0.079365", "-0.035088", "0.000000"];
      assert.deepEqual(result.stderr.split("\n").filter(line => line.startsWith("lavfi.deflicker.")), luminance.flatMap((value, i) => [
        `lavfi.deflicker.luminance=${value}`, `lavfi.deflicker.new_luminance=${adjusted[i]}`, `lavfi.deflicker.relative_change=${relative[i]}`
      ]));
    }
  });
}

for (const [option, hex] of [
  ["m=am:3", "16a1ff004890d93c86cf317ac5266fb92dadff19a0ff048ba8fa489be93a8bdc"],
  ["size=2:gm", "1283f50052a4f64497e93789a6205e9c1d70c31080eb036fa7f94799e93a8bdc"],
  ["size=5:m=qm", "16a1ff004890d93c86cf317ac5266fb92dadff19a0ff048ba8fa489be93a8bdc"],
  ["size=3:m=am", "159cff0053a6fa4582ca30779f1e5a96258ef61493ff047fa7fa489ae93a8bdc"],
  ["size=2:m=gm", "1283f50052a4f64497e93789a6205e9c1d70c31080eb036fa7f94799e93a8bdc"]
]) {
  it(`matches native deflicker option binding for ${option}`, async () => {
    const input = Buffer.from("0d5eaf0051a2f34495e63788d92a7bcc1d6ebf1061b20354a5f64798e93a8bdc", "hex");
    const result = await run(`deflicker=${option}`, input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.output.toString("hex"), hex);
  });
}

for (const [name, values, measurements] of [
  ["black frames", [0, 0, 0, 0], Array(4).fill(["0.000000", "-nan", "-nan"])],
  ["initial black frame", [0, 50, 50, 50], [
    ["0.000000", "-nan", "inf"], ...Array(3).fill(["50.000000", "50.000000", "0.000000"])
  ]],
  ["nonblack control", [50, 50, 50, 50], Array(4).fill(["50.000000", "50.000000", "0.000000"])]
] as const) {
  it(`matches native deflicker bypass metadata and bytes for ${name}`, async () => {
    const input = Buffer.from(values.flatMap(value => [value, value, value, value]));
    const result = await run("deflicker=s=3:m=am:bypass=1,metadata=print", input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, input);
    assert.deepEqual(result.stderr.split("\n").filter(line => line.startsWith("lavfi.deflicker.")),
      measurements.flatMap(([luminance, adjusted, relative]) => [
        `lavfi.deflicker.luminance=${luminance}`,
        `lavfi.deflicker.new_luminance=${adjusted}`,
        `lavfi.deflicker.relative_change=${relative}`
      ]));
  });
}

for (const option of ["size=1", "s=130", "m=unknown", "bypass=2", "unknown=1"]) {
  it(`rejects ${option} without replacing output`, async () => {
    const result = await run(`deflicker=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "KEEP");
  });
}
it("preserves YUV chroma while correcting luma", async () => {
  const input = Buffer.from([36, 40, 44, 192, 44, 40, 36, 32, 30].flatMap(v => [v,v+4,v+8,v+12,71,183]));
  const result = await run("deflicker=s=3", input, "yuv420p");
  assert.equal(result.exitCode, 0, result.stderr);
  const luma = Buffer.from("272b3034555d666e575f676f5f616264282c2f3324282b2f2124282c1e22262a1e22262a", "hex");
  assert.deepEqual(result.output, Buffer.from(Array.from({length: 9}, (_, i) => [...luma.subarray(i*4,i*4+4),71,183]).flat()));
});

// Native FFmpeg references also cover defaults and the remaining smoothing modes.
for (const [filter, hex] of [
  ["deflicker", "42495058434a5158434a5056484a4b4d25282c2f2225292c2023272a1e22262a1e22262a"],
  ["deflicker=s=5:m=median", "a9bccfe22b2f3438282c2f3328292a2b2124272a1f2225281e2225291e2225291e22262a"],
  ["deflicker=s=3:m=gm", "272b303442495056454b52584a4c4d4f282c2f3324282b2f2124282c1e22262a1e22262a"],
  ["deflicker=s=3:m=hm", "272b2f34373d42483a3f454a3e3f4042282b2f3324272b2f2124282c1e22262a1e22262a"],
  ["deflicker=s=3:m=qm", "272b303469737e886a747e8775777a7c282c2f3324282b2f2124282c1e22262a1e22262a"],
  ["deflicker=s=3:m=cm", "272c30347884909c7a85909b86898b8e282c303324282c2f2124282c1e22262a1e22262a"],
  ["deflicker=s=3:m=pm", "272c30347884909c7a85909b86898b8e282c303324282c2f2124282c1e22262a1e22262a"]
]) it(`matches native ${filter}`, async () => {
  const result = await run(filter!);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), hex);
});
for (const format of ["gray16le", "gray16be"]) it(`retains full ${format} precision`, async () => {
  const input = Buffer.alloc(fixture.length * 2);
  fixture.forEach((value, index) => input.writeUInt16LE(value * 251 + 7, index * 2));
  if (format === "gray16be") input.swap16();
  const result = await run("deflicker=s=3", input, format);
  assert.equal(result.exitCode, 0, result.stderr);
  if (format === "gray16be") result.output.swap16();
  assert.equal(result.output.toString("hex"), "af26fb2a462f92339553ef5b4a64a46cbc55865d50651a6d335d245f15610663b727532bee2e8a32d5236a27ff2a942e85202224be275a2b4d1e1522de25a729711d5d2149253529");
});

it("honors memory limits and cancellation", async () => {
  const frame = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4), ptsSeconds: 0, durationSeconds: 1, keyframe: true };
  await assert.rejects(deflicker([frame], "", "gray", new MediaBudgetTracker({ maxMemoryBytes: 1 })), /memory/i);
  const controller = new AbortController();
  const pending = deflicker([frame], "", "gray", new MediaBudgetTracker(), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

// FFmpeg 7.0.2-static references: rounding must match all six metadata decimals.
for (const { mode, pixels, metadata } of [
  {
    mode: "cm",
    pixels: "17a7ff0053a6fa4688d2327ca920609f289aff169aff0485a7fa489ae93a8bdc",
    metadata: [
      "lavfi.deflicker.luminance=70.500000",
      "lavfi.deflicker.new_luminance=125.293777",
      "lavfi.deflicker.relative_change=0.777217",
      "lavfi.deflicker.luminance=138.500000",
      "lavfi.deflicker.new_luminance=142.574814",
      "lavfi.deflicker.relative_change=0.029421",
      "lavfi.deflicker.luminance=142.500000",
      "lavfi.deflicker.new_luminance=130.615585",
      "lavfi.deflicker.relative_change=-0.083399",
      "lavfi.deflicker.luminance=146.500000",
      "lavfi.deflicker.new_luminance=114.747620",
      "lavfi.deflicker.relative_change=-0.216740",
      "lavfi.deflicker.luminance=86.500000",
      "lavfi.deflicker.new_luminance=121.420692",
      "lavfi.deflicker.relative_change=0.403707",
      "lavfi.deflicker.luminance=90.500000",
      "lavfi.deflicker.new_luminance=144.300278",
      "lavfi.deflicker.relative_change=0.594478",
      "lavfi.deflicker.luminance=158.500000",
      "lavfi.deflicker.new_luminance=161.188660",
      "lavfi.deflicker.relative_change=0.016963",
      "lavfi.deflicker.luminance=162.500000",
      "lavfi.deflicker.new_luminance=162.500000",
      "lavfi.deflicker.relative_change=0.000000"
    ]
  },
  {
    mode: "pm",
    pixels: "17a7ff0053a6fa4688d2327ca920609f289aff169aff0485a7fa489ae93a8bdc",
    metadata: [
      "lavfi.deflicker.luminance=70.500000",
      "lavfi.deflicker.new_luminance=125.293800",
      "lavfi.deflicker.relative_change=0.777217",
      "lavfi.deflicker.luminance=138.500000",
      "lavfi.deflicker.new_luminance=142.574844",
      "lavfi.deflicker.relative_change=0.029421",
      "lavfi.deflicker.luminance=142.500000",
      "lavfi.deflicker.new_luminance=130.615601",
      "lavfi.deflicker.relative_change=-0.083399",
      "lavfi.deflicker.luminance=146.500000",
      "lavfi.deflicker.new_luminance=114.747643",
      "lavfi.deflicker.relative_change=-0.216740",
      "lavfi.deflicker.luminance=86.500000",
      "lavfi.deflicker.new_luminance=121.420700",
      "lavfi.deflicker.relative_change=0.403708",
      "lavfi.deflicker.luminance=90.500000",
      "lavfi.deflicker.new_luminance=144.300308",
      "lavfi.deflicker.relative_change=0.594478",
      "lavfi.deflicker.luminance=158.500000",
      "lavfi.deflicker.new_luminance=161.188690",
      "lavfi.deflicker.relative_change=0.016963",
      "lavfi.deflicker.luminance=162.500000",
      "lavfi.deflicker.new_luminance=162.500046",
      "lavfi.deflicker.relative_change=0.000000"
    ]
  },
  {
    mode: "am",
    pixels: "159cff0053a6fa4582ca30779f1e5a96258ef61493ff047fa7fa489ae93a8bdc",
    metadata: [
      "lavfi.deflicker.luminance=70.500000",
      "lavfi.deflicker.new_luminance=117.166664",
      "lavfi.deflicker.relative_change=0.661939",
      "lavfi.deflicker.luminance=138.500000",
      "lavfi.deflicker.new_luminance=142.500000",
      "lavfi.deflicker.relative_change=0.028881",
      "lavfi.deflicker.luminance=142.500000",
      "lavfi.deflicker.new_luminance=125.166664",
      "lavfi.deflicker.relative_change=-0.121637",
      "lavfi.deflicker.luminance=146.500000",
      "lavfi.deflicker.new_luminance=107.833336",
      "lavfi.deflicker.relative_change=-0.263936",
      "lavfi.deflicker.luminance=86.500000",
      "lavfi.deflicker.new_luminance=111.833328",
      "lavfi.deflicker.relative_change=0.292871",
      "lavfi.deflicker.luminance=90.500000",
      "lavfi.deflicker.new_luminance=137.166672",
      "lavfi.deflicker.relative_change=0.515654",
      "lavfi.deflicker.luminance=158.500000",
      "lavfi.deflicker.new_luminance=161.166687",
      "lavfi.deflicker.relative_change=0.016824",
      "lavfi.deflicker.luminance=162.500000",
      "lavfi.deflicker.new_luminance=162.500000",
      "lavfi.deflicker.relative_change=0.000000"
    ]
  }
]) for (const bypass of [false, true]) {
  it(`matches native ${mode} luminance metadata (bypass=${bypass})`, async () => {
    const input = Buffer.from("0d5eaf0051a2f34495e63788d92a7bcc1d6ebf1061b20354a5f64798e93a8bdc", "hex");
    const result = await run(`deflicker=s=3:m=${mode}:bypass=${Number(bypass)},metadata=print`, input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), bypass ? input.toString("hex") : pixels);
    assert.deepEqual(result.stderr.split("\n").filter(line => line.startsWith("lavfi.deflicker.")), metadata);
  });
}

for (const [mode, size, expected] of [
  ["cm", 2, ["114.562218", "140.528458", "144.527679", "123.763100", "88.545174", "133.167694", "160.524918", "162.500000"]],
  ["cm", 5, ["124.686012", "126.339867", "131.648315", "136.817825", "140.785843", "152.106979", "161.715759", "162.500000"]],
  ["pm", 2, ["109.891983", "140.514236", "144.513840", "120.300667", "88.522598", "129.059097", "160.512466", "162.500000"]],
  ["pm", 5, ["129.738602", "130.344131", "136.528900", "142.299988", "146.513580", "154.910019", "161.731201", "162.500015"]]
] as const) {
  it(`matches native ${mode} luminance with window size ${size}`, async () => {
    const input = Buffer.from("0d5eaf0051a2f34495e63788d92a7bcc1d6ebf1061b20354a5f64798e93a8bdc", "hex");
    const result = await run(`deflicker=s=${size}:m=${mode}:bypass=1,metadata=print`, input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, input);
    assert.deepEqual(result.stderr.split("\n").filter(line => line.startsWith("lavfi.deflicker.new_luminance=")),
      expected.map(value => `lavfi.deflicker.new_luminance=${value}`));
  });
}
