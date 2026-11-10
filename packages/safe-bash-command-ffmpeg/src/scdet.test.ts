import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frames = [[16, 16, 16, 16], [16, 16, 16, 32], [16, 16, 16, 16],
  [200, 200, 200, 200], [200, 200, 200, 200], [200, 200, 200, 200],
  [80, 80, 80, 80], [16, 16, 16, 16]].map(y => Buffer.from([...y, ...Array<number>(8).fill(128)]));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);

async function run(filter: string, level = "info", clip = input, format = "yuv444p", graph = false) {
  const volume = Volume.fromJSON({ "/in.y4m": clip, "/o.raw": "KEEP", "/stats.log": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", level, "-y", "-i", "/in.y4m",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "/o.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    }, stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.y4m"), clip);
  assert.equal(volume.readFileSync("/stats.log", "utf8"), "KEEP");
  return { ...result, stderr, output: volume.readFileSync("/o.raw") as Buffer };
}

const changes = ["100.000, lavfi.scd.time: 0.75", "100.000, lavfi.scd.time: 1.5", "54.688, lavfi.scd.time: 1.75"];
for (const filter of ["scdet", "scdet=t=10", "scdet=threshold=10", "scdet=10"]) {
  it(`matches native pass-through bytes and scene reports for ${filter}`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.concat(frames));
    assert.equal(createHash("sha256").update(result.output).digest("hex"),
      "4d240453b9d26c288a7fb339c50f2c0385b0484486434ef7365e15258e7a1278");
    assert.deepEqual(result.stderr.trim().split("\n"), changes.map(change => `lavfi.scd.score: ${change}`));
  });
}

it("reports each native MAFD, score, and detected timestamp independently of output count", async () => {
  const result = await run("scdet=t=10,metadata=print");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat(frames));
  assert.deepEqual(result.stderr.split("\n").filter(line => line.startsWith("lavfi.scd.mafd=")),
    ["0.000", "4.688", "4.688", "179.688", "0.000", "0.000", "117.188", "62.500"].map(value => `lavfi.scd.mafd=${value}`));
  assert.deepEqual(result.stderr.split("\n").filter(line => line.startsWith("lavfi.scd.score=")),
    ["0.000", "4.688", "0.000", "100.000", "0.000", "0.000", "100.000", "54.688"].map(value => `lavfi.scd.score=${value}`));
  assert.deepEqual(result.stderr.split("\n").filter(line => line.startsWith("lavfi.scd.time=")),
    ["0.75", "1.5", "1.75"].map(value => `lavfi.scd.time=${value}`));
});

for (const filter of ["scdet=t=10:sc_pass=1", "scdet=threshold=10:s=yes", "scdet=10:10:1"]) {
  it(`keeps only detected frames with original timestamps for ${filter}`, async () => {
    const result = await run(`${filter},metadata=print`, "info", input, "yuv444p", true);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.concat([frames[3]!, frames[6]!, frames[7]!]));
    assert.equal(createHash("sha256").update(result.output).digest("hex"),
      "0b1f642325ac22a98b4bdc5db1551c030a22e79b001d528ef6e12a32d2fdff24");
    assert.deepEqual(result.stderr.split("\n").filter(line => line.startsWith("frame:")),
      ["frame:0 pts:3 pts_time:0.75", "frame:1 pts:6 pts_time:1.5", "frame:2 pts:7 pts_time:1.75"]);
  });
}

it("uses an inclusive threshold and compares frames rejected by pass mode", async () => {
  const result = await run("scdet=t=100:sc_pass=1");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([frames[3]!, frames[6]!]));
  const zero = await run("scdet=t=0:sc_pass=1", "error");
  assert.equal(zero.exitCode, 0, zero.stderr);
  assert.deepEqual(zero.output, Buffer.concat(frames));
  assert.equal(zero.stderr, "");
});

it("starts fresh scene history for each scdet in a chain", async () => {
  const result = await run("scdet=s=1,scdet=s=1", "warning");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([frames[6]!, frames[7]!]));
  assert.equal(result.stderr, "");
});

for (const filter of ["scdet=t=-1", "scdet=t=101", "scdet=t=garbage", "scdet=sc_pass=2", "scdet=unknown=1", "scdet=enable=1"]) {
  it(`preserves existing output on invalid options: ${filter}`, async () => {
    const result = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "KEEP");
  });
}

for (const [width, depth] of [[32, 8], [2, 10]] as const) {
  it(`normalizes ${width}-pixel ${depth}-bit luma without the narrow 8-bit SAD overread`, async () => {
    const payloads = [16, 32, 64, 64].map(value => {
      const bytes = Buffer.alloc(width * 6 * (depth === 8 ? 1 : 2));
      for (let i = 0; i < width * 6; i++) {
        const sample = (i < width * 2 ? value : 128) * 2 ** (depth - 8);
        if (depth === 8) bytes[i] = sample;
        else bytes.writeUInt16LE(sample, i * 2);
      }
      return bytes;
    });
    const clip = Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H2 F4:1 Ip A1:1 C444${depth === 8 ? "" : "p10"}\n`),
      ...payloads.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);
    const result = await run("scdet=t=6.25:s=1,metadata=print", "info", clip, depth === 8 ? "yuv444p" : "yuv444p10le");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.concat(payloads.slice(1, 3)));
    assert.deepEqual(result.stderr.split("\n").filter(line => line.startsWith("lavfi.scd.mafd=")),
      ["lavfi.scd.mafd=6.250", "lavfi.scd.mafd=12.500"]);
    assert.deepEqual(result.stderr.split("\n").filter(line => line.startsWith("lavfi.scd.score=")),
      ["lavfi.scd.score=6.250", "lavfi.scd.score=6.250"]);
  });
}

it("retains the passing null and select controls", async () => {
  const all = await run("null", "error");
  assert.equal(all.exitCode, 0, all.stderr);
  assert.deepEqual(all.output, Buffer.concat(frames));
  const selected = await run("select='eq(n,3)+eq(n,6)+eq(n,7)'", "error");
  assert.equal(selected.exitCode, 0, selected.stderr);
  assert.deepEqual(selected.output, Buffer.concat([frames[3]!, frames[6]!, frames[7]!]));
});
