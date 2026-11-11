import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frames = [[50, 30, 212], [120, 180, 60], [80, 140, 190]].map(planes =>
  Buffer.concat([Buffer.from("FRAME\n"), ...planes.map(value => Buffer.alloc(8, value))]));
const payload = Buffer.concat(frames);

async function run(filter: string, aspect = "1:1", graph = false) {
  const input = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H2 F4:1 Ip A${aspect} C444\n`), payload]);
  const volume = Volume.fromJSON({ "/wide.y4m": input, "/o.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/wide.y4m",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "yuv4mpegpipe", "/o.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/wide.y4m"), input);
  return { ...result, stderr, output: volume.readFileSync("/o.raw") as Buffer };
}

for (const [filter, aspect] of [
  ["null", "1:1"], ["setsar=2", "2:1"], ["setsar=3/2", "3:2"],
  ["setsar=sar=1.5", "3:2"], ["setsar=ratio=6/4", "3:2"], ["setsar=r=2", "2:1"],
  ["setsar", "0:0"], ["setsar=0", "0:0"], ["setsar=w/h", "2:1"],
  ["setsar=2,setsar=sar/2", "1:1"], ["setsar=2,setsar=dar", "4:1"],
  ["setsar=3/2:max=2", "1:1"], ["setsar=3/2:10", "3:2"],
  ["setsar=1001/1000", "1:1"], ["setsar=1001/1000:max=1001", "1001:1000"]
]) {
  it(`${filter} preserves dimensions, cadence and every frame byte`, async () => {
    const result = await run(filter!);
    assert.equal(result.exitCode, 0, result.stderr);
    const end = result.output.indexOf(10);
    assert.deepEqual(result.output.subarray(0, end).toString().split(" ").slice(0, 7),
      ["YUV4MPEG2", "W4", "H2", "F4:1", "Ip", `A${aspect}`, "C444"]);
    assert.deepEqual(result.output.subarray(end + 1), payload);
    // Native FFmpeg 7.0.2 reference includes frame markers and all three planes.
    assert.equal(createHash("sha256").update(result.output.subarray(end + 1)).digest("hex"),
      "d86d70fb3c18708061a68ade3be7582d36f78c7b6bb58e336e19376814a677e0");
  });
}

it("uses the incoming sample aspect ratio in expressions", async () => {
  const result = await run("setsar=sar*2", "3:2");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.output.subarray(0, result.output.indexOf(10)).toString().includes(" A3:1 "));
  assert.deepEqual(result.output.subarray(result.output.indexOf(10) + 1), payload);
});

it("exposes the new aspect to downstream crop and preserves frame timestamps", async () => {
  const result = await run("setsar=2,crop=iw:ih:keep_aspect=1,select=eq(t\\,1/4)");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.output.subarray(0, result.output.indexOf(10)).toString().includes(" A2:1 "));
  assert.deepEqual(result.output.subarray(result.output.indexOf(10) + 1), frames[1]);
});

for (const option of ["-1", "1/0", "bogus", "unknown=2", "2:max=0", "2:max=2147483648", "2:100:1", "2:enable=0"]) {
  it(`rejects setsar=${option} before replacing the destination`, async () => {
    const result = await run(`setsar=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("setsar"), result.stderr);
    assert.equal(result.output.toString(), "KEEP");
  });
}

for (const [filter, aspect] of [["setsar=2", "2:1"], ["setsar=3/2", "3:2"],
  ["setsar=3/2,setdar=dar*2", "3:1"], ["setdar=4/3,setsar=sar*3", "2:1"]]) {
  it(`complex graph ${filter} preserves frame bytes and cadence`, async () => {
    const result = await run(filter!, "1:1", true);
    assert.equal(result.exitCode, 0, result.stderr);
    const end = result.output.indexOf(10);
    assert.deepEqual(result.output.subarray(0, end).toString().split(" ").slice(0, 7),
      ["YUV4MPEG2", "W4", "H2", "F4:1", "Ip", `A${aspect}`, "C444"]);
    assert.deepEqual(result.output.subarray(end + 1), payload);
  });
}
