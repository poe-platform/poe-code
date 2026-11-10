import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const luma = [[16, 16, 16, 16], [16, 16, 16, 32], [16, 16, 16, 16],
  [200, 200, 200, 200], [200, 200, 200, 200], [200, 200, 200, 200], [80, 80, 80, 80], [16, 16, 16, 16]];
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...luma.map(ys => Buffer.concat([Buffer.from("FRAME\n"), Buffer.from([...ys, ...Array<number>(8).fill(128)])]))]);

async function run(filter: string, graph = false) {
  const volume = Volume.fromJSON({ "/in.y4m": input, "/o.raw": "KEEP", "/stats.log": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-y", "-i", "in.y4m",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "o.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    }, stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(volume.readFileSync("/stats.log", "utf8"), "KEEP");
  return { result, volume, stderr };
}

for (const graph of [false, true]) {
  for (const [filter, key, values] of [
    ["metadata=mode=add:key=lavfi.demo:value=first,metadata=print:key=lavfi.demo", "lavfi.demo", luma.map(() => "first")],
    ["signalstats,metadata=add:key=lavfi.signalstats.YMIN:value=0,metadata=mode=print:key=lavfi.signalstats.YMIN", "lavfi.signalstats.YMIN", luma.map(ys => String(Math.min(...ys)))],
    ["metadata=add:key=lavfi.demo:value=first,metadata=add:key=LAVFI.DEMO:value=second,metadata=print", "lavfi.demo", luma.map(() => "first")],
    ["metadata=add:key=lavfi.demo:value=,metadata=add:key=lavfi.demo:value=second,metadata=print", "lavfi.demo", luma.map(() => "")],
    ["metadata=add:key=__proto__:value=first,metadata=print", "__proto__", luma.map(() => "first")],
    ["signalstats,metadata=print:key=lavfi.signalstats.YMIN", "lavfi.signalstats.YMIN", luma.map(ys => String(Math.min(...ys)))],
    ["metadata=print:key=lavfi.demo", "lavfi.demo", []]
  ] as const) {
    it(`preserves pixels and frame metadata for ${filter} (graph=${graph})`, async () => {
      const { result, volume, stderr } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/o.raw") as Buffer;
      assert.equal(output.length, 96);
      assert.equal(createHash("sha256").update(output).digest("hex"), "4d240453b9d26c288a7fb339c50f2c0385b0484486434ef7365e15258e7a1278");
      assert.equal(stderr, values.map((value, index) => `frame:${index} pts:${index} pts_time:${index / 4}\n${key}=${value}\n`).join(""));
    });
  }
}

for (const options of ["add", "add:key=demo", "add:value=first", "add:key=:value=first", "add:key=demo:value=first:unknown=1"]) {
  it(`rejects metadata=${options} without replacing output`, async () => {
    const { result, volume, stderr } = await run(`metadata=${options}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("metadata:"), stderr);
    assert.equal(volume.readFileSync("/o.raw", "utf8"), "KEEP");
  });
}
