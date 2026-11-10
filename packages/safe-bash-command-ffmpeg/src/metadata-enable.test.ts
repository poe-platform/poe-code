import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const luma = [[16, 16, 16, 16], [16, 16, 16, 32], [16, 16, 16, 16],
  [200, 200, 200, 200], [200, 200, 200, 200], [200, 200, 200, 200],
  [80, 80, 80, 80], [16, 16, 16, 16]];
const frames = luma.map(values => Buffer.from([...values, ...Array<number>(8).fill(128)]));
async function run(filter: string, graph = false, level = "info") {
  const volume = Volume.fromJSON({ "/o.raw": "KEEP", "/stats.log": "KEEP" });
  volume.writeFileSync("/in.y4m", Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
    ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", level, "-y", "-i", "in.y4m", ...(graph ? ["-filter_complex", `[0:v]${filter}[o]`, "-map", "[o]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "o.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    }, stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal(volume.readFileSync("/stats.log", "utf8"), "KEEP");
  return { result, volume, output: volume.readFileSync("/o.raw") as Buffer, error: Buffer.concat(errors).toString().split("\n").map(line =>
    line.startsWith("frame:") ? line.split(" ").filter(Boolean).join(" ") : line).join("\n") };
}

const key = "lavfi.signalstats.YMIN";
const all = frames.map((_, n) => n);
for (const [expression, selected] of [
  [undefined, all], ["eq(n,3)", [3]], ["eq(t,0.75)", [3]],
  ["between(t,0.5,1)", [2, 3, 4]], ["eq(w,2)*eq(h,2)", all],
  ["0", []], ["1", all], ["0.25", []], ["-0.5", all],
  ["NAN", []], ["INF", all], ["isnan(NAN)", all]
] as const) {
  for (const graph of [false, true]) {
    it(`metadata print enable=${expression} preserves video (${graph ? "graph" : "simple"})`, async () => {
      const { result, output, error } = await run(
        `signalstats,metadata=print:key=${key}${expression === undefined ? "" : `:enable='${expression}'`}`, graph);
      assert.equal(result.exitCode, 0, error);
      assert.deepEqual(output, Buffer.concat(frames));
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "4d240453b9d26c288a7fb339c50f2c0385b0484486434ef7365e15258e7a1278");
      assert.equal(error, selected.map(n =>
        `frame:${n} pts:${n} pts_time:${n / 4}\n${key}=${Math.min(...luma[n]!)}\n`).join(""));
    });
  }
}

it("keeps frame numbers local to metadata while retaining input timestamps", async () => {
  const { result, output, error } = await run(`trim=start_frame=2,signalstats,metadata=mode=print:key=${key}:enable='eq(n,1)'`);
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, Buffer.concat(frames.slice(2)));
  assert.equal(error, `frame:1 pts:3 pts_time:0.75\n${key}=200\n`);
});

it("preserves the null control and suppresses metadata below info level", async () => {
  for (const [filter, level] of [["null", "info"], [`signalstats,metadata=print:enable='eq(n,3)'`, "error"]]) {
    const { result, output, error } = await run(filter!, false, level!);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(output, Buffer.concat(frames));
    assert.equal(error, "");
  }
});

for (const [prefix, expression, level] of [
  ["signalstats", "", "info"], ["signalstats", "unknown", "info"],
  ["signalstats", "eq(n,)", "info"], ["signalstats", "eq(n,3", "info"],
  ["signalstats", "unknown", "error"], ["trim=end_frame=0", "unknown", "info"]
]) {
  it(`rejects invalid enable=${expression} before replacing output (${prefix}, ${level})`, async () => {
    const { result, output, error } = await run(`${prefix},metadata=print:enable='${expression}'`, false, level);
    assert.notEqual(result.exitCode, 0, error);
    assert.ok(error.includes("metadata"), error);
    assert.equal(output.toString(), "KEEP");
  });
}

it("adds metadata only to enabled frames", async () => {
  const { result, output, error } = await run("metadata=add:key=demo:value=yes:enable='eq(n,3)',metadata=print:key=demo");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, Buffer.concat(frames));
  assert.equal(error, "frame:3 pts:3 pts_time:0.75\ndemo=yes\n");
});

it("deletes metadata only from enabled frames", async () => {
  const { result, output, error } = await run(`signalstats,metadata=delete:key=${key}:enable='eq(n,3)',metadata=print:key=${key}`);
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, Buffer.concat(frames));
  assert.equal(error, all.filter(n => n !== 3).map(n =>
    `frame:${n} pts:${n} pts_time:${n / 4}\n${key}=${Math.min(...luma[n]!)}\n`).join(""));
});

it("lets disabled frames bypass metadata selection", async () => {
  const { result, output, error } = await run("metadata=select:key=missing:enable='eq(n,3)'");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, Buffer.concat(frames.filter((_, n) => n !== 3)));
  assert.equal(error, "");
});

it("modifies metadata only on enabled frames", async () => {
  const { result, output, error } = await run(`signalstats,metadata=modify:key=${key}:value=99:enable='eq(n,3)',metadata=print:key=${key}`);
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, Buffer.concat(frames));
  assert.equal(error, all.map(n =>
    `frame:${n} pts:${n} pts_time:${n / 4}\n${key}=${n === 3 ? 99 : Math.min(...luma[n]!)}\n`).join(""));
});

it("writes only enabled frames to a metadata file even below info level", async () => {
  const { result, volume, output, error } = await run(
    `signalstats,metadata=print:key=${key}:file=/enabled.log:enable='eq(n,3)'`, false, "error");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, Buffer.concat(frames));
  assert.equal(error, "");
  assert.equal(volume.readFileSync("/enabled.log", "utf8"),
    `frame:3    pts:3       pts_time:0.75\n${key}=200\n`);
});
