import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from([36, 40, 44, 192, 44, 40, 36, 32, 30].flatMap(value =>
  [0, 4, 8, 12].map(delta => value + delta)));

async function run(filter: string, source = input, destination = "pipe:1", framerate = "4") {
  const volume = Volume.fromJSON({ "/in.raw": source, "/out.raw": "KEEP" });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo",
      "-pixel_format", "gray", "-video_size", "2x2", "-framerate", framerate, "-i", "/in.raw",
      "-vf", `${filter},showinfo`, "-fps_mode", "passthrough", "-pix_fmt", "gray",
      "-bitexact", "-f", "rawvideo", destination],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { stdout.push(data); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, volume, stderr, stdout: Buffer.concat(stdout) };
}

// Native Linux FFmpeg 7.0.2 output, including every pixel after the flash.
for (const [filter, hex] of [
  ["null", input.toString("hex")],
  ["lagfun=decay=0.75", "24282c30282c30342c303438c0c4c8cc909396996c6e7073515354563d3e3f412e2f2f30"],
  ["lagfun=decay=0.5", "24282c30282c30342c303438c0c4c8cc606264663031323424282c302024282c1e22262a"],
  ["lagfun=planes=0", input.toString("hex")],
  ["lagfun=0.75:1", "24282c30282c30342c303438c0c4c8cc909396996c6e7073515354563d3e3f412e2f2f30"],
  ["lagfun=decay=0", input.toString("hex")],
  ["lagfun=decay=1", "24282c30282c30342c303438c0c4c8ccc0c4c8ccc0c4c8ccc0c4c8ccc0c4c8ccc0c4c8cc"],
  ["lagfun=planes=2", input.toString("hex")]
] as const) {
  it(`preserves grayscale frame timing and applies ${filter}`, async () => {
    const { exitCode, volume, stdout, stderr } = await run(filter);
    assert.equal(exitCode, 0, stderr);
    assert.equal(stdout.toString("hex"), hex);
    assert.ok(stderr.includes("time_base: 1/4"), stderr);
    const frames = stderr.split("\n").filter(line => line.includes("pts_time:"));
    assert.equal(frames.length, 9, stderr);
    for (const [n, line] of frames.entries()) {
      const fields = line.split(" ").filter(Boolean);
      assert.ok(fields.includes(`pts:${n}`), line);
      assert.ok(fields.includes(`pts_time:${n / 4}`), line);
    }
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}

it("retains fractional brightness and rounds halfway values to even", async () => {
  const source = Buffer.from([6, 0, 0, 0].flatMap(value => Array(4).fill(value)));
  const result = await run("lagfun=0.75,lagfun=0", source);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, Buffer.from([6, 4, 3, 3].flatMap(value => Array(4).fill(value))));
});

it("uses the default decay of 0.95", async () => {
  const source = Buffer.from([200, 0, 0, 0].flatMap(value => Array(4).fill(value)));
  const result = await run("lagfun", source);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, Buffer.from([200, 190, 180, 171].flatMap(value => Array(4).fill(value))));
});

for (const option of ["decay=-0.1", "decay=1.1", "decay=bad", "planes=1.5", "unknown=1"]) {
  it(`rejects ${option} before replacing output`, async () => {
    const result = await run(`lagfun=${option}`, input, "/out.raw");
    assert.notEqual(result.exitCode, 0, result.stderr);
    assert.ok(result.stderr.includes("lagfun:"), result.stderr);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.volume.readFileSync("/out.raw", "utf8"), "KEEP");
    assert.deepEqual(result.volume.readFileSync("/in.raw"), input);
  });
}

const commandInput = Buffer.from("c8b4a08c0a0a0a0a0a0a0a0a0a0a0a0a", "hex");
for (const [filter, hex] of [
  ["sendcmd=c=1 lagfun@a decay 1,lagfun@a=decay=0.5", "c8b4a08cc8b4a08cc8b4a08cc8b4a08c"],
  ["sendcmd=c=1 lagfun planes 0,lagfun=decay=1", "c8b4a08c0a0a0a0a0a0a0a0a0a0a0a0a"],
  ["sendcmd=c='1 lagfun planes 0;2 lagfun planes 1',lagfun=decay=0.5", "c8b4a08c0a0a0a0a645a5046322d2823"],
  ["sendcmd=c=1.5 lagfun@b decay 1,lagfun@a=decay=0.5,lagfun@b=decay=0.5", "c8b4a08c645a5046645a5046645a5046"],
  ["sendcmd=c=1 lagfun decay 2,lagfun=decay=0.5", "c8b4a08c645a5046322d282319161412"],
  ["lagfun=decay=1", "c8b4a08cc8b4a08cc8b4a08cc8b4a08c"],
  ["lagfun=decay=0.5", "c8b4a08c645a5046322d282319161412"]
] as const) {
  it(`matches native command/control bytes for ${filter}`, async () => {
    const result = await run(filter, commandInput, "pipe:1", "1");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString("hex"), hex);
  });
}

// Native FFmpeg flag masks select only bit zero for grayscale input.
for (const [planes, enabled] of [
  ["all", true], ["none", false], ["-1", false], ["16", false],
  ["1", true], ["0", false], ["-2", true], ["all-1", false],
  ["none+1", true], ["16+1", true], ["0xffffffff", true],
  ["4294967295", true], ["+16", true]
] as const) {
  it(`matches native lagfun planes=${planes} bytes`, async () => {
    const source = Buffer.from("c8b4a08c0a0a0a0a0a0a0a0a0a0a0a0a", "hex");
    const result = await run(`lagfun=planes=${planes}`, source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString("hex"), enabled
      ? "c8b4a08cbeab9885b4a2907eab9a8978" : source.toString("hex"));
  });
}
