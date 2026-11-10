import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const luma = [[16, 16, 16, 16], [16, 16, 16, 32], [16, 16, 16, 16],
  [200, 200, 200, 200], [200, 200, 200, 200], [200, 200, 200, 200],
  [80, 80, 80, 80], [16, 16, 16, 16]];
const frames = luma.map(values => Buffer.from([...values, ...Array<number>(8).fill(128)]));
async function run(filter: string, level = "info", gray = false) {
  const volume = Volume.fromJSON({ "/o.raw": "KEEP", "/stats.log": "KEEP" });
  volume.writeFileSync("/in.y4m", Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
    ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]));
  if (gray) volume.writeFileSync("/in.gray", Buffer.from(luma.flat()));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", level, "-y",
      ...(gray ? ["-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2", "-framerate", "4", "-i", "in.gray"] : ["-i", "in.y4m"]), "-vf", filter,
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

for (const mode of ["print", "select"]) {
  it(`matches native blackframe metadata=${mode} and exact output bytes`, async () => {
    const { result, output, error } = await run(`blackframe=amount=75:threshold=32,metadata=${mode}:key=lavfi.blackframe.pblack`);
    assert.equal(result.exitCode, 0, error);
    const selected = [0, 1, 2, 7];
    assert.deepEqual(output, Buffer.concat(mode === "print" ? frames : selected.map(i => frames[i]!)));
    assert.equal(createHash("sha256").update(output).digest("hex"), mode === "print"
      ? "4d240453b9d26c288a7fb339c50f2c0385b0484486434ef7365e15258e7a1278"
      : "3f7382978e0df24a7a7c9d5aad97c29ece57973f07f36a78f7ef5fab75b5c5ba");
    const logs = error.split("\n").filter(line => line.includes("pblack:"));
    assert.deepEqual(logs, selected.map((n, i) => `[blackframe] frame:${n} pblack:${i === 1 ? 75 : 100} pts:${n} t:${(n / 4).toFixed(6)} type:I last_keyframe:${n}`));
    assert.deepEqual(error.split("\n").filter(line => line.startsWith("lavfi.blackframe.pblack=")),
      mode === "print" ? [100, 75, 100, 100].map(value => `lavfi.blackframe.pblack=${value}`) : []);
    if (mode === "print") for (const n of selected) {
      assert.ok(error.includes(`frame:${n} pts:${n} pts_time:${n / 4}\n`), error);
    }
  });
}

it("uses default amount=98 and threshold=32", async () => {
  const { result, output, error } = await run("blackframe,metadata=select:key=lavfi.blackframe.pblack");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, Buffer.concat([frames[0]!, frames[2]!, frames[7]!]));
});
it("selects metadata with logging disabled and accepts positional options", async () => {
  const { result, output, error } = await run("blackframe=75:32,metadata=select:key=lavfi.blackframe.pblack", "error");
  assert.equal(result.exitCode, 0, error);
  assert.equal(error, "");
  assert.deepEqual(output, Buffer.concat([frames[0]!, frames[1]!, frames[2]!, frames[7]!]));
});
it("rounds the native integer amount option before comparing percentages", async () => {
  const { result, output, error } = await run("blackframe=75.1:32,metadata=select:key=lavfi.blackframe.pblack");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, Buffer.concat([frames[0]!, frames[1]!, frames[2]!, frames[7]!]));
});
it("sets zero percent metadata when amount and threshold are zero", async () => {
  const { result, output, error } = await run("blackframe=0:0,metadata=print:key=lavfi.blackframe.pblack");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, Buffer.concat(frames));
  assert.equal(error.split("lavfi.blackframe.pblack=0\n").length - 1, 8);
});
for (const filter of ["blackframe=amount=-1", "blackframe=amount=101", "blackframe=threshold=-1",
  "blackframe=threshold=256", "blackframe=amount=nope", "blackframe=unknown=1", "blackframe=75:32:1"]) {
  it(`rejects invalid options before overwriting output: ${filter}`, async () => {
    const { result, output } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.toString(), "KEEP");
  });
}

it("accepts the native thresh alias and rounds half-integers to even", async () => {
  const { result, output, error } = await run("blackframe=amount=74.5:thresh=32.5,metadata=select:key=lavfi.blackframe.pblack");
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(output, Buffer.concat([frames[0]!, frames[1]!, frames[2]!, frames[7]!]));
});
it("preserves existing analysis metadata", async () => {
  const { result, error } = await run("signalstats,blackframe=75:32,metadata=print:key=lavfi.signalstats.YMIN");
  assert.equal(result.exitCode, 0, error);
  assert.equal(error.split("lavfi.signalstats.YMIN=").length - 1, 8);
});

it("measures grayscale samples without applying limited-range RGB conversion", async () => {
  const { result, error } = await run("blackframe=75:17,metadata=print:key=lavfi.blackframe.pblack", "info", true);
  assert.equal(result.exitCode, 0, error);
  assert.deepEqual(error.split("\n").filter(line => line.startsWith("lavfi.blackframe.pblack=")),
    [100, 75, 100, 100].map(value => `lavfi.blackframe.pblack=${value}`));
});
