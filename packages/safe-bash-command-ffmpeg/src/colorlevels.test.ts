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
  ["colorlevels", source],
  ["colorlevels=rimin=-1:rimax=-1", "00121c2a40487b80803882beb28755d7dce1f2a050fffaf6"],
  ["colorlevels=0.2:0:0:0:0.8:1:1:1:0:0:0:0:1:0.7", "000c1c012c48805980175abed75e55ff99e1ff6f50ffaef6"],
  ["colorlevels=rimin=1:rimax=0:gomin=0.2:gomax=0.8:bimin=-1:bimax=-1", "f33d00cb59337f7f74be81bd4b844228b7e60f933c03c9ff"],
  ["colorlevels=rimin=0.5:rimax=0.5", "00121c0040480080800082be00875500dce100a05000faf6"],
  ["colorlevels=rimin=-1:rimax=-1:preserve=max", "00121c2a40487b80803882beb48855d7dce1f09e4ffcf7f3"],
  ["colorlevels=rimin=-1:rimax=-1:preserve=avg", "0016232c434c7c81813985c2b28755d7dce1f09f4ffdf9f5"],
  ["colorlevels=rimin=-1:rimax=-1:preserve=sum", "0016232c434c7c81813985c2b28755d7dce1f09f4ffdf9f5"],
  ["colorlevels=rimin=-1:rimax=-1:preserve=nrm", "00131d2b424b7c81813883bfb38755d7dce1f09f4ffdf8f5"],
  ["colorlevels=rimin=-1:rimax=-1:preserve=pwr", "00121c2b414a7c81813882beb38755d7dce1f09f4ffdf8f4"],
  ["colorlevels=rimin=-1:rimax=-1:enable=0", source],
  ["colorlevels=rimin=0.2:rimax=0.8:gomax=0.7", "000c1c012c48805980175abed75e55ff99e1ff6f50ffaef6"],
  ["colorlevels=rimin=-1:rimax=-1:preserve=lum", "0019282d454e7d82823a86c4b38855d7dce1f09f4ffdf8f4"]
] as const) {
  it(`matches native RGB bytes for ${filter}`, async () => {
    const result = await render(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString("hex"), expected);
  });
}

for (const filter of ["colorlevels=bogus=1", "colorlevels=rimin=-2", "colorlevels=gomax=1.1", "colorlevels=aomin=-0.1", "colorlevels=preserve=7", "colorlevels=rimin=NaN"]) {
  it(`rejects ${filter} without overwriting output`, async () => {
    const result = await render(filter, source, "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.volume.readFileSync("/out.raw", "utf8"), "existing output");
  });
}

for (const [format, input, filter, expected] of [
  ["rgba", "0c121c0a34404828808080464182be64b4875582d7dce1a0f0a050befcfaf6dc",
    "colorlevels=aimin=-1:aimax=-1:romin=0.1:gomax=0.7", "240c1c00482c48248c598048545abe6dbb5e5591db99e1b6f16f50dafcaef6ff"],
  ["bgra", "0c121c0a34404828808080464182be64b4875582d7dce1a0f0a050befcfaf6dc",
    "colorlevels=aimin=-1:aimax=-1:romin=0.1:gomax=0.7", "0c0c3300342c5a2480598c48415ac46db45e6691d799e4b6f06f61dafcaef6ff"],
  ["rgb24", source, "format=bgr24,colorlevels=rimin=-1:rimax=-1:preserve=lum", "0019282d454e7d82823a86c4b38855d7dce1f09f4ffdf8f4"],
  ["rgb24", source + "06090e1a202440404020415f5a432a6b6e707850287e7d7b",
    "colorlevels=rimin=-1:rimax=-1:gimin=-1:gimax=-1:bimin=-1:bimax=-1",
    "0000002a32337b7874387bbdb28042d7dee6f29c3cffffff0000002a32337b7874377bbdb27f41d6dee5f29c3cffffff"]
] as const) {
  it(`matches native ${format} channels and per-frame extrema for ${filter}`, async () => {
    const result = await render(filter, input, "pipe:1", format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString("hex"), expected);
  });
}

it("evaluates the timeline for each frame", async () => {
  const result = await render("colorlevels=rimin=-1:rimax=-1:enable='gte(n,1)'", source + source);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString("hex"), source + "00121c2a40487b80803882beb28755d7dce1f2a050fffaf6");
});
