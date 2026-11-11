import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { gblur } from "./gblur.js";
import { createFfmpegCommand } from "./index.js";

const impulse = Buffer.from(Array.from({ length: 32 * 32 }, (_, i) => i === 0 || i === 16 * 32 + 16 ? 245 : 20));

async function run(filter: string, input = impulse, format = "gray", size = "32x32") {
  const volume = Volume.fromJSON({ "/in": input, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
      "-framerate", "4", "-i", "/in", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format,
      "-bitexact", "-f", "rawvideo", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out") as Buffer };
}

// Native FFmpeg 7.0.2: corner and center impulses exercise spreading and boundaries.
for (const [options, hash, corner] of [
  ["sigma=1:steps=1", "555b1a39790b96a6298a4769d93dc91579c425067cc81a3c1b9cccf35b02576c", 160],
  ["sigma=2:steps=3", "00f84e4aa950e3409e23c9d3885f15906c3995fc301b7eaf623bba6e7aa9583c", 84]
] as const) {
  it(`matches native gblur=${options} including border pixels`, async () => {
    const result = await run(`gblur=${options}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, impulse.length);
    assert.equal(result.output[0], corner);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

for (const filter of ["null", "gblur=sigma=0", "gblur=planes=0", "gblur=enable=0"]) {
  it(`preserves input for ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, impulse);
  });
}

it("accepts positional options and numeric expressions", async () => {
  const named = await run("gblur=sigma=2:steps=3");
  const positional = await run("gblur=4/2:3:15:-1");
  assert.equal(positional.exitCode, 0, positional.stderr);
  assert.deepEqual(positional.output, named.output);
});

it("enables blur on selected frames without changing their count or timestamps", async () => {
  const blurred = await run("gblur=1");
  const result = await run("gblur=1:enable='eq(t,0.25)'", Buffer.concat([impulse, impulse, impulse]));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([impulse, blurred.output, impulse]));
});

for (const option of ["sigma=-1", "sigma=1025", "sigma=nan", "steps=0", "steps=7", "planes=16", "sigmaV=-2", "unknown=1", "1:1:15:-1:2"]) {
  it(`rejects invalid gblur option ${option} before replacing output`, async () => {
    const result = await run(`gblur=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("gblur"), result.stderr);
    assert.equal(result.output.toString(), "KEEP");
  });
}

// FFmpeg 7.0.2 portable (-cpuflags 0) references also cover one-pixel dimensions.
for (const [format, w, h, filter, hash] of [
  ["gray", 32, 32, "gblur", "7675d88706f03cc73f5deecf5cc1eaada8d2f44e5f7ce03f8453716949091aa6"],
  ["gray", 32, 32, "gblur=2:6", "0f992124680e1ff7041fc3df8c4e618a1c78deaff1a2d559d6a7927c91d2c228"],
  ["gray", 32, 32, "gblur=1:1:15:0", "53ed1f0543a17df6806172e8363e0729fd16c5277f51d65a34c89ee6ea84b4ca"],
  ["gray", 32, 32, "gblur=0:3:15:2", "e45932b43df48c348a77824a03aa4a004175f9021c5b51bd68a6d505004defa0"],
  ["gray", 3, 1, "gblur=1", "8d0446fce0a0cfb30a1723b1911b3e9cab9db803f2712750bc13169af368e0a1"],
  ["gray", 1, 3, "gblur=1", "8d0446fce0a0cfb30a1723b1911b3e9cab9db803f2712750bc13169af368e0a1"],
  ["gray", 1, 1, "gblur=1", "27abdeddfe8503496adeb623466caa47da5f63abd2bc6fa19f6cfcb73ecfed70"],
  ["gray", 32, 32, "gblur=2:2.5:1.5", "f55ee7e0a5444b8f1e1c5ef4479a6e9d43e467468cb364f61b18aee4528f7e39"],
  ["gray16le", 32, 32, "gblur=2:3", "fe254635b79293f1f071d3904c0dfdfeb96d2258fb99c99ca9ff79d697ef508d"],
  ["gray16be", 32, 32, "gblur=2:3", "8bcf687061e12aa39a597cfab421909b4b3a8a3027f89855c9276b1834975351"],
  ["yuv420p", 32, 32, "gblur=2:3:1", "00c2d98bbd6fb0dbe2bb5abbca354bc686cdcac83e4ae176e645b4bdfb434a80"],
  ["yuv420p", 32, 32, "gblur=1:1:6", "d32846e1a08b0438c3b19325b878dd82f05b83b8fd9903387e8d1a779bbd5c42"],
  ["yuv422p", 32, 32, "gblur=2:3", "cb852d724b15602baf671ead011b5312b332a1f03fc2f8f65d211cf9db676805"],
  ["yuv444p", 32, 32, "gblur=2:3", "113ca021c0d5c8d22ab0d6adda4627bac24bb3304bc9d2c564df122177e43c54"],
  ["yuv420p10le", 32, 32, "gblur=2:3", "d7318ea84d5f4f8abebeadabce639491081ccca1ed9a4fdd40e556e329c9d3a2"],
  ["yuv444p16le", 32, 32, "gblur=2:3", "acb6d63dec5b8698ba42cf1c7270464948b67d37098a9d1ea0608405fad03654"],
  ["rgba", 32, 32, "gblur=2:3", "70b9463fa1afe669ba7dfe55120eaa430ca267ad8587a4fca96ddaaaedfd0f2f"],
  ["gbrap", 32, 32, "gblur=2:3:2", "38cb7422cc50f24c8e773886810ec86a68b396a8ad61014709be5f446640ca86"],
  ["gray", 32, 32, "gblur=1024:6", "5f70bf18a086007016e948b04aed3b82103a36bea41755b6cddfaf10ace3c6ef"]
] as const) {
  it(`matches native ${format} ${w}x${h} ${filter}`, async () => {
    const plane = Buffer.from(Array.from({ length: w * h }, (_, i) => i === 0 || i === Math.floor(h / 2) * w + Math.floor(w / 2) ? 245 : 20));
    let input = plane;
    if (format.startsWith("yuv")) {
      const chroma = format.includes("420") ? Math.ceil(w / 2) * Math.ceil(h / 2) : format.includes("422") ? Math.ceil(w / 2) * h : w * h;
      input = Buffer.concat([input, Buffer.from(Array.from({ length: chroma }, (_, i) => i === 0 ? 200 : 80)),
        Buffer.from(Array.from({ length: chroma }, (_, i) => i === chroma / 2 ? 230 : 120))]);
    }
    if (format.includes("16") || format.includes("10")) {
      const bytes = Buffer.alloc(input.length * 2);
      input.forEach((v, i) => format.endsWith("be") ? bytes.writeUInt16BE(v * 257, i * 2) : bytes.writeUInt16LE(v * (format.includes("10") ? 4 : 257), i * 2));
      input = bytes;
    }
    if (format === "rgba") input = Buffer.from([...plane].flatMap(v => [v, 255 - v, 80, v]));
    if (format === "gbrap") input = Buffer.concat([plane, Buffer.alloc(w * h, 60), Buffer.alloc(w * h, 90), Buffer.alloc(w * h, 200)]);
    const result = await run(filter, input, format, `${w}x${h}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, input.length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

it("bounds blur scratch memory and checks cancellation inside recursive passes", async () => {
  const data = new Uint8Array(32 * 32 * 4).fill(80);
  const frame = { data, width: 32, height: 32, ptsSeconds: 0, durationSeconds: 0.25, keyframe: true };
  await assert.rejects(gblur([frame], "2:6", "gbrap", new MediaBudgetTracker({ maxMemoryBytes: data.length })), /maxMemoryBytes/);
  const controller = new AbortController();
  const budget = new MediaBudgetTracker();
  const rendering = gblur([frame], "2:6", "gbrap", budget, controller.signal);
  controller.abort(new Error("stop blur"));
  await assert.rejects(rendering, /stop blur/);
  assert.equal(budget.getStats().currentMemoryBytes, data.length);
});
