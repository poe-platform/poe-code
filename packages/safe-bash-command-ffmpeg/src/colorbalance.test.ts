import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = "0c121c3440488080804182beb48755d7dce1f0a050fcfaf6";

async function render(filter: string, input = source, destination = "pipe:1", format = "rgb24") {
  const volume = Volume.fromJSON({ "/out.raw": "existing output" });
  volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format, "-video_size", "4x2", "-framerate", "4", "-i", "/in.raw",
      "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", destination],
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
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString(), volume };
}

// Complete raw RGB frames captured from native FFmpeg 7.0.2.
for (const [filter, expected] of [
  ["null", source],
  ["colorbalance", source],
  ["colorbalance=rs=0.4", "53121c3440488080804182beb48755d7dce1f0a050fcfaf6"],
  ["colorbalance=gs=0.4", "0c591c3440488080804182beb48755d7dce1f0a050fcfaf6"],
  ["colorbalance=bs=0.4", "0c12633440488080804182beb48755d7dce1f0a050fcfaf6"],
  ["colorbalance=rm=0.4", "0c121c7b40488080804182beb48755d7dce1f0a050fcfaf6"],
  ["colorbalance=gm=0.4", "0c121c3487488080804182beb48755d7dce1f0a050fcfaf6"],
  ["colorbalance=bm=0.4", "0c121c34408f8080804182beb48755d7dce1f0a050fcfaf6"],
  ["colorbalance=rh=0.4", "0c121c344048c780808882befb8755ffdce1ffa050fffaf6"],
  ["colorbalance=gh=0.4", "0c121c34404880c78041c9beb4ce55d7ffe1f0e750fcfff6"],
  ["colorbalance=bh=0.4", "0c121c3440488080c74182ffb4879cd7dcfff0a097fcfaff"],
  ["colorbalance=pl=1", source],
  ["colorbalance=rs=-1:gm=1:bh=-1", "00121c34f34880800041820cb48700d7dc2ff0a000fcfa44"],
  ["colorbalance=rs=-1:gm=1:bh=-1:pl=1", "141414009d008080807abb44848484ffff85a0a0a0ffff9d"],
  ["colorbalance=0.4:0:0:0:-0.35:0:0:0:0.25:1", "3500004d1b616a6a962b6cd49e716bdcdcdcda8a66f9f9f9"],
  ["colorbalance=rs=0.4:gm=-0.35:bh=0.25:pl=true:", "3500004d1b616a6a962b6cd49e716bdcdcdcda8a66f9f9f9"],
  ["colorbalance=rs=0.4:0.2", "53361c3440488080804182beb48755d7dce1f0a050fcfaf6"],
  ["colorbalance=rs=0.4:rs=0", source],
  ["colorbalance=rs=0.4:gm=-0.35:bh=0.25", "53121c3402488080ad4182ebb48782d7dcfff0a07dfcfaff"],
  ["colorbalance=rs=0.4:gm=-0.35:bh=0.25:pl=1", "3500004d1b616a6a962b6cd49e716bdcdcdcda8a66f9f9f9"]
] as const) {
  it(`matches native RGB bytes for ${filter}`, async () => {
    const result = await render(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString("hex"), expected);
  });
}

it("preserves alpha across multiple frames and writes the balanced pixels to a file", async () => {
  const input = "0c121c000c121c400c121c800c121cff".repeat(4);
  const result = await render("colorbalance=rs=0.4", input, "/out.raw", "rgba");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.volume.readFileSync("/out.raw").toString("hex"), "53121c0053121c4053121c8053121cff".repeat(4));
});

for (const option of ["rs=1.01", "bh=-1.01", "rm=NaN", "gm=1/0", "bs=", "unknown=1", "pl=2", "pl=nonsense"]) {
  it(`rejects ${option} without replacing existing output`, async () => {
    const result = await render(`colorbalance=${option}`, source, "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /colorbalance/);
    assert.equal(result.volume.readFileSync("/out.raw").toString(), "existing output");
    assert.equal(result.stdout.length, 0);
  });
}
