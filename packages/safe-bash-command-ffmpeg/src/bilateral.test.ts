import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { bilateral } from "./bilateral.js";
import { createFfmpegCommand } from "./index.js";

const edge = Buffer.from(Array.from({ length: 1024 }, (_, i) => {
  const x = i % 32, y = Math.floor(i / 32);
  return (x < 16 ? 55 : 170) + (x + 2 * y) % 7;
}));

async function run(filter: string, input = edge, format = "gray", size = "32x32") {
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

// Native FFmpeg 7.0.2: noise on either side of a strong intensity edge.
for (const [sigmaR, hash] of [
  [0.05, "9c5e9f513b54737a48609f8afb1b598f0944370de21a35ccff56f39a964e36d6"],
  [0.5, "4673bff1e324b5d48fe9f750143927f05d98d732f8a99b3da1cd64d80e5a3a1a"]
] as const) {
  it(`matches native bilateral intensity range ${sigmaR}`, async () => {
    const result = await run(`bilateral=sigmaS=2:sigmaR=${sigmaR}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, edge.length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

for (const filter of ["null", "bilateral=planes=0", "bilateral=sigmaS=0", "bilateral=enable=0"]) {
  it(`preserves input for ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, edge);
  });
}

it("accepts positional options, expressions, and named instances", async () => {
  const expected = await run("bilateral=sigmaS=2:sigmaR=0.5:planes=1");
  const result = await run("bilateral@edge=4/2:1/2:1");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, expected.output);
});

it("keeps unselected YUV planes intact", async () => {
  const result = await run("bilateral=2:0.05:2", Buffer.concat([edge, edge, edge]), "yuv444p");
  assert.equal(result.exitCode, 0, result.stderr);
  const blurred = await run("bilateral=2:0.05");
  assert.deepEqual(result.output, Buffer.concat([edge, blurred.output, edge]));
});

it("enables blur by source timestamp without changing frame count", async () => {
  const blurred = await run("bilateral=2:0.5");
  const result = await run("bilateral=2:0.5:enable='eq(t,0.25)'", Buffer.concat([edge, edge, edge]));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([edge, blurred.output, edge]));
});

for (const option of ["sigmaS=-1", "sigmaS=513", "sigmaR=-1", "sigmaR=1.1", "sigmaR=nan", "planes=16", "unknown=1", "2:0.5:1:1"]) {
  it(`rejects invalid bilateral option ${option} before replacing output`, async () => {
    const result = await run(`bilateral=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("bilateral"), result.stderr);
    assert.equal(result.output.toString(), "KEEP");
  });
}

for (const [format, filter, hash] of [
  ["gray", "bilateral", "176cfdc6433d878828305cf704ee16c520640874fbab5efc40e984fe2b9dad75"],
  ["gray", "bilateral=2:0", "176cfdc6433d878828305cf704ee16c520640874fbab5efc40e984fe2b9dad75"],
  ["gray16le", "bilateral=2:0.05", "7cfc9dbf2a03254b198788e7ea516545b7d7b866b29c38fec5b8784df2f9f20f"],
  ["gray16be", "bilateral=2:0.5", "00669073df3d75e8a6c3080745f7dc97c92d3f54de1a5ebca9f634d0f0c1e890"],
  ["yuv420p", "bilateral=2:0.5:7", "4ef87c3008f5ecb86d05c61f706df523976939610ab74a9936379e8fc75a20f3"],
  ["rgba", "bilateral=2:0.5:15", "6fd51f6e0efd805c581be543a4af3160870db59c1bd2b152bee38492ac630cd1"],
  ["rgba", "bilateral=planes=0", "1e1a5af5af86755eb4626cea8bc2adc3a2f4961588b8a6adba43fd33f592baec"],
  ["rgba", "bilateral=enable=0", "1e1a5af5af86755eb4626cea8bc2adc3a2f4961588b8a6adba43fd33f592baec"],
  ["rgba", "bilateral=2:0.5:15,bilateral=2:0.5:15", "aec0d44c27b6edd9099d09e804a005255a40d896c030aa131e25e63a2c89ed68"],
  ["gbrap", "bilateral=2:0.5:9", "4175b13e8172a0932071b3aa850012dd07294c91ab40da9d620929bebe9ebed4"]
] as const) {
  it(`matches native ${format} ${filter}`, async () => {
    let input = edge;
    if (format === "gray16le" || format === "gray16be") {
      input = Buffer.alloc(edge.length * 2);
      edge.forEach((value, i) => format === "gray16le" ? input.writeUInt16LE(value * 257, i * 2) : input.writeUInt16BE(value * 257, i * 2));
    } else if (format === "yuv420p") input = Buffer.concat([edge, edge.subarray(0, 256), edge.subarray(0, 256)]);
    else if (format === "rgba") input = Buffer.from([...edge].flatMap(value => [value, 255 - value, 80, value]));
    else if (format === "gbrap") input = Buffer.concat([edge, Buffer.alloc(1024, 60), Buffer.alloc(1024, 90), edge]);
    const result = await run(filter, input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, input.length);
    assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
  });
}

for (const size of ["1x5", "5x1"]) {
  it(`matches native bilateral at ${size} boundaries`, async () => {
    const result = await run("bilateral=2:0.5", Buffer.from([55, 56, 55, 170, 171]), "gray", size);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.from([58, 62, 69, 157, 165]));
  });
}

it("bounds scratch memory and releases it when cancelled during filtering", async () => {
  const data = new Uint8Array(32 * 32 * 4).fill(80);
  const frame = { data, width: 32, height: 32, ptsSeconds: 0, durationSeconds: 0.25, keyframe: true };
  await assert.rejects(bilateral([frame], "2:0.5", "gbrap", new MediaBudgetTracker({ maxMemoryBytes: data.length })), /maxMemoryBytes/);
  const controller = new AbortController();
  const budget = new MediaBudgetTracker();
  const checkCpu = budget.checkCpu.bind(budget);
  let checks = 0;
  budget.checkCpu = () => {
    checkCpu();
    if (++checks === 3) controller.abort(new Error("stop bilateral"));
  };
  await assert.rejects(bilateral([frame], "2:0.5:15", "gbrap", budget, controller.signal), /stop bilateral/);
  assert.equal(budget.getStats().currentMemoryBytes, data.length);
});
