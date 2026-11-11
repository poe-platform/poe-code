import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

const pictures = [[16, 16, 16, 16], [16, 16, 16, 32], [16, 16, 16, 16],
  [200, 200, 200, 200], [200, 200, 200, 200], [200, 200, 200, 200], [80, 80, 80, 80], [16, 16, 16, 16]];
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...pictures.flatMap(y => [Buffer.from("FRAME\n"), Buffer.from(y), Buffer.alloc(8, 128)])
]);

async function run(filter: string, complex = false) {
  const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
  const argumentValues = createCommandArguments([
    "-hide_banner", "-nostats", "-v", "info", "-y", "-i", "/in.y4m",
    ...(complex ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
    "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"
  ]);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    command: "ffmpeg", args: argumentValues.args, argumentValues,
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.y4m"), input);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

// FFmpeg 7.0.2 reference hashes for the issue fixture and unchanged-time-base controls.
for (const complex of [false, true]) {
  for (const filter of [
    "settb=1/1000,select='eq(pts,750)'",
    "settb=1/1000,select='eq(t,0.75)'",
    "settb=expr=1/1000,select='eq(pts,750)*eq(TB,0.001)'",
    "settb=tb=intb/250,select='eq(pts,750)'",
    "settb=AVTB,select='eq(pts,750000)'",
    "settb=1/1000,settb=intb*250,select='eq(pts,3)'",
    "settb,select='eq(pts,3)'",
    "settb=intb,select='eq(pts,3)'",
    "settb=1/1000,setpts=PTS+250,select='eq(pts,1000)'",
    "select='eq(pts,3)'",
    "select='eq(n,3)'"
  ]) {
    it(`${filter} selects the same picture (${complex ? "complex" : "simple"})`, async () => {
      const result = await run(filter, complex);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.length, 12);
      assert.equal(createHash("sha256").update(result.output).digest("hex"),
        "45874da89521bb74a21e4818cad2bcdf8bf9407acb7f67541f0a05b815c758e1");
    });
  }
  it(`settb exposes rescaled metadata ticks without changing pixels or time (${complex ? "complex" : "simple"})`, async () => {
    const result = await run("settb=1/1000,signalstats,metadata=mode=print:key=lavfi.signalstats.YMIN", complex);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 96);
    assert.equal(createHash("sha256").update(result.output).digest("hex"),
      "4d240453b9d26c288a7fb339c50f2c0385b0484486434ef7365e15258e7a1278");
    const lines = result.stderr.split("\n").filter(line => line.startsWith("frame:") || line.startsWith("lavfi."))
      .map(line => line.split(" ").filter(Boolean).join(" "));
    assert.deepEqual(lines, pictures.flatMap((y, n) => [
      `frame:${n} pts:${n * 250} pts_time:${n / 4}`, `lavfi.signalstats.YMIN=${Math.min(...y)}`
    ]));
  });
}

for (const [filter, ticks] of [
  ["settb=1/2", [0, 1, 1, 2, 2, 3, 3, 4]],
  ["setpts=PTS-4,settb=1/2", [-2, -2, -1, -1, 0, 1, 1, 2]],
  ["settb=1/2,settb=1/4", [0, 2, 2, 4, 4, 6, 6, 8]],
  ["fps=8,settb=intb/2", Array.from({ length: 16 }, (_, n) => n * 2)],
  ["settb=1/1000,fps=8", Array.from({ length: 16 }, (_, n) => n)]
] as const) {
  it(`${filter} rounds incoming ticks to the new clock`, async () => {
    const result = await run(`${filter},showinfo=checksum=0`);
    assert.equal(result.exitCode, 0, result.stderr);
    const actual = result.stderr.split("\n").filter(line => line.startsWith("[showinfo] n:"))
      .map(line => Number(line.split(" ").find(field => field.startsWith("pts:"))!.slice(4)));
    assert.deepEqual(actual, ticks);
  });
}

for (const expression of ["0", "-1/1000", "1/0", "unknown", "expr=", "other=1/1000", "1/1000:1/4", "enable=1"]) {
  it(`settb=${expression} rejects invalid options without replacing output`, async () => {
    const result = await run(`settb=${expression}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("settb"), result.stderr);
    assert.equal(result.output.toString(), "KEEP");
  });
}

for (const filter of ["settb=1/2,fps=4", "select='lt(n,3)',settb=1/1000,fps=4"]) {
  it(`${filter} preserves the input EOF independently of the last frame`, async () => {
    const result = await run(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.length, 8 * 12);
  });
}

it("settb rescales frame durations as well as PTS", async () => {
  const result = await run("settb=1/1000,showinfo=checksum=0");
  assert.equal(result.exitCode, 0, result.stderr);
  const lines = result.stderr.split("\n").filter(line => line.startsWith("[showinfo] n:"));
  assert.equal(lines.length, 8);
  for (const line of lines) assert.ok(line.includes("duration:250 duration_time:0.25"), line);
});
