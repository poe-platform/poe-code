import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from([36, 40, 44, 192, 44, 40, 36, 32, 30].flatMap(value => [0, 4, 8, 12].map(delta => value + delta)));
async function render(filter: string, graph = false, destination = "pipe:1") {
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  volume.writeFileSync("/in.raw", input);
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-y", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2", "-framerate", "4", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:v]${filter},showinfo[out]`, "-map", "[out]"] : ["-vf", `${filter},showinfo`]),
      "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", destination],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
  } as never);
  return { ...result, volume, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

for (const graph of [false, true]) {
  for (const [filter, expected] of [
    ["null", input.toString("hex")],
    ["atadenoise=s=5:0a=0.10:0b=0.30", "262a2e32272b2f332a2e3236c0c4c8cc2c303438282c303424282c3022262a2e2024282c"],
    ["atadenoise=s=5:0a=0.10:0b=0.30:a=s", "262a2e32272b2f33282c3034c0c4c8cc282c3034262a2e3224282c3022262a2e2024282c"],
    ["atadenoise=s=5:p=0", input.toString("hex")]
  ]) {
    it(`renders all native bytes and timestamps for ${filter} (graph=${graph})`, async () => {
      const result = await render(filter!, graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout.toString("hex"), expected);
      const pts = result.stderr.split("\n").filter(line => line.includes("pts_time:")).map(line =>
        Number(line.split("pts:")[1]!.trim().split(" ")[0]));
      assert.deepEqual(pts, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });
  }
}

for (const option of ["s=4", "s=130", "a=bad", "0a=0.31", "0b=-1", "bogus=1"]) {
  it(`rejects invalid ${option}`, async () => {
    const result = await render(`atadenoise=${option}`, false, "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.volume.readFileSync("/out.raw", "utf8"), "keep");
  });
}
