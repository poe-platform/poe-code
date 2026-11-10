import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "113a638cb5de07305982abd4fd264f78a1caf31c456e97c0";
const gray = "323232adadad282828a3a3a36b6b6b9999996161618f8f8f";
const inverted = "cdcdcd525252d7d7d75c5c5c9494946666669e9e9e707070";

async function render(filter: string, outputFormat = "rgb24") {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "2x2", "-r", "1",
      "-i", "/in.raw", "-vf", filter, "-pix_fmt", outputFormat, "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, errors: Buffer.concat(errors).toString(), volume };
}

// Native FFmpeg 7.0.2 reference bytes for the RGB24 and format=gray controls.
for (const [filter, expected] of [
  ["format=gray", gray],
  ["format=gray,negate=y", inverted],
  ["format=gray8,negate=components=y", inverted],
  ["format=gray16be,negate=y", inverted],
  ["format=ya8,negate=y", inverted],
  ["format=gray,negate=components=16", inverted],
  ["format=gray,negate", inverted],
  ["format=gray,negate=components=0", gray],
  ["format=gray,negate=components=none", gray],
  ["negate=components=none", input],
  ["negate=none", input],
  ["negate=components=0", input],
  ["negate=components=none+r", "ee3a6373b5def830597dabd402264f87a1ca0c1c459197c0"],
  ["format=gray,negate=y,negate=y", gray],
  ["format=gray,negate=y:enable=0", gray],
  ["format=gray,format=rgb24,negate=components=r", "cd323252adadd728285ca3a3946b6b6699999e6161708f8f"],
  ["negate=components=r", "ee3a6373b5def830597dabd402264f87a1ca0c1c459197c0"]
] as const) {
  it(`uses negotiated components for ${filter}`, async () => {
    const { result, errors, volume } = await render(filter);
    assert.equal(result.exitCode, 0, errors);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
  });
}

for (const filter of [
  "format=gray,negate=r", "format=gray,negate=u", "format=gray,negate=a", "format=gray,negate=1",
  "format=gray,format=rgb24,negate=y", "negate=y"
]) {
  it(`rejects components absent from the negotiated input for ${filter}`, async () => {
    const { result, errors } = await render(filter);
    assert.notEqual(result.exitCode, 0);
    assert.match(errors, /negate: Requested components not available/);
  });
}

for (const [negate, alpha] of [["y", 255], ["y+a", 0], ["y:negate_alpha=1", 0]] as const) {
  it(`handles grayscale alpha for negate=${negate}`, async () => {
    const { result, errors, volume } = await render(`format=ya8,negate=${negate}`, "rgba");
    assert.equal(result.exitCode, 0, errors);
    const expected = Buffer.from([205, 82, 215, 92, 148, 102, 158, 112]
      .flatMap(value => [value, value, value, alpha]));
    assert.deepEqual(volume.readFileSync("/out.raw"), expected);
  });
}
