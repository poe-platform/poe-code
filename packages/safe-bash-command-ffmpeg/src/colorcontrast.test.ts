import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = "0c121c3440488080804182beb48755d7dce1f0a050fcfaf6";
const weighted = "colorcontrast=rc=0.6:gm=-0.4:by=0.3:rcw=0.5:gmw=0.3:byw=0.2";
const contrasted = "09131d31414a808080308dcfc07e48d5dce2ff913afcf9f5";
const preserved = "09131e31414a808080308dcec07e48d5dce2ff943bfcf9f5";

async function render(filter: string, input = source, format = "rgb24", destination = "pipe:1") {
  const volume = Volume.fromJSON({ "/out.raw": "existing output" });
  volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format,
      "-video_size", "4x2", "-framerate", "4", "-i", "/in.raw", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", destination],
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

// Complete raw frames from native FFmpeg 7.0.2, including the neutral center patch.
for (const [filter, expected] of [
  ["null", source], ["colorcontrast", source], [weighted, contrasted], [`${weighted}:pl=1`, preserved],
  ["colorcontrast=0.6:-0.4:0.3:0.5:0.3:0.2:1", preserved],
  ["colorcontrast=rc=1:gm=-1:by=1", source],
  [`${weighted}:enable=0`, source],
  [`${weighted}:enable=NaN`, source],
  [`${weighted}:pl=1:`, preserved],
  ["colorcontrast=rc=3/5:gm=-2/5:by=3/10:rcw=1/2:gmw=3/10:byw=1/5:pl=1", preserved]
] as const) {
  it(`matches native RGB bytes for ${filter}`, async () => {
    const result = await render(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString("hex"), expected);
  });
}

it("filters selected frames and writes the full video to a file", async () => {
  const result = await render(`${weighted}:enable='eq(n,1)'`, source.repeat(2), "rgb24", "/out.raw");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.volume.readFileSync("/out.raw").toString("hex"), source + contrasted);
});

it("preserves alpha, including RGB samples under zero alpha", async () => {
  const withAlpha = (hex: string) => Array.from({ length: 8 }, (_, i) => hex.slice(i * 6, i * 6 + 6) + ["00", "40", "80", "ff"][i % 4]).join("");
  const result = await render(`${weighted}:pl=1`, withAlpha(source), "rgba");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString("hex"), withAlpha(preserved));
});

for (const option of ["rc=1.01", "gm=-1.01", "by=NaN", "rcw=-0.1", "gmw=1.01", "byw=1/0", "pl=1.01", "rc=", "unknown=1"]) {
  it(`rejects ${option} without replacing existing output`, async () => {
    const result = await render(`colorcontrast=${option}`, source, "rgb24", "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("colorcontrast"), result.stderr);
    assert.equal(result.volume.readFileSync("/out.raw").toString(), "existing output");
    assert.equal(result.stdout.length, 0);
  });
}
