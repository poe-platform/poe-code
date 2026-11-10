import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const luma = [[16, 16, 16, 16], [16, 16, 16, 32], [16, 16, 16, 16],
  [200, 200, 200, 200], [200, 200, 200, 200], [200, 200, 200, 200],
  [80, 80, 80, 80], [16, 16, 16, 16]];
const frames = luma.map(values => Buffer.from([...values, ...Array<number>(8).fill(128)]));
async function run(filter: string) {
  const volume = Volume.fromJSON({ "/o.raw": "KEEP", "/stats.log": "KEEP" });
  volume.writeFileSync("/in.y4m", Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
    ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-y", "-i", "in.y4m", "-vf", filter,
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
  return { result, output: volume.readFileSync("/o.raw") as Buffer, error: Buffer.concat(errors).toString() };
}

for (const mode of ["modify", "mode=modify"]) {
  for (const existing of [true, false]) {
    it(`metadata=${mode} changes only existing keys (existing=${existing})`, async () => {
      const key = existing ? "lavfi.signalstats.YMIN" : "lavfi.demo";
      const { result, output, error } = await run(`${existing ? "signalstats," : ""}metadata=${mode}:key=${key}:value=99,metadata=print:key=${key}`);
      assert.equal(result.exitCode, 0, error);
      assert.deepEqual(output, Buffer.concat(frames));
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "4d240453b9d26c288a7fb339c50f2c0385b0484486434ef7365e15258e7a1278");
      assert.equal(error, existing ? frames.map((_, n) =>
        `frame:${String(n).padEnd(4)} pts:${String(n).padEnd(7)} pts_time:${n / 4}\n${key}=99\n`).join("") : "");
    });
  }
}

it("preserves other metadata and the print-only control", async () => {
  const before = await run("signalstats,metadata=print");
  const after = await run("signalstats,metadata=modify:key=lavfi.signalstats.YMIN:value=99,metadata=print");
  assert.equal(before.result.exitCode, 0, before.error);
  assert.equal(after.result.exitCode, 0, after.error);
  assert.deepEqual(before.output, Buffer.concat(frames));
  assert.deepEqual(after.output, before.output);
  const lines = before.error.split("\n");
  assert.deepEqual(lines.filter(line => line.startsWith("lavfi.signalstats.YMIN=")),
    luma.map(values => `lavfi.signalstats.YMIN=${Math.min(...values)}`));
  assert.equal(after.error, lines.map(line => line.startsWith("lavfi.signalstats.YMIN=")
    ? "lavfi.signalstats.YMIN=99" : line).join("\n"));
});

it("leaves a missing key absent in print-only and populated metadata controls", async () => {
  for (const filter of ["metadata=print:key=lavfi.demo",
    "signalstats,metadata=modify:key=lavfi.demo:value=99,metadata=print:key=lavfi.demo"]) {
    const { result, output, error } = await run(filter);
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(output, Buffer.concat(frames));
    assert.equal(error, "");
  }
});

for (const options of ["value=99", "key=lavfi.signalstats.YMIN"]) {
  it(`rejects modify without key and value before replacing output: ${options}`, async () => {
    const { result, output, error } = await run(`signalstats,metadata=modify:${options}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(error.includes("metadata: modify requires key and value"), error);
    assert.equal(output.toString(), "KEEP");
  });
}
