import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "113a638cb5de07305982abd4fd264f78a1caf31c456e97c0";
const inverted = "eec59c734a21f8cfa67d542b02d9b0875e350ce3ba91683f";

async function render(filter: string, generated = false) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", ...(generated
      ? ["-f", "lavfi", "-i", "color=red:s=2x2:r=1:d=2"]
      : ["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "2x2", "-r", "1", "-i", "/in.raw"]),
    "-vf", filter, "-pix_fmt", "rgb24", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  return (volume.readFileSync("/out.raw") as Buffer).toString("hex");
}

// Native FFmpeg 7.0.2: the two RGB packets start at byte offsets 0 and 12.
for (const [expression, expected] of [
  ["pos", input.slice(0, 24) + inverted.slice(24)],
  ["isnan(pos)", input],
  ["0", input],
  ["1", inverted],
  ["eq(pos\\,12)", input.slice(0, 24) + inverted.slice(24)]
]) {
  it(`evaluates negate enable=${expression} with source packet positions`, async () => {
    assert.equal(await render(`negate=enable=${expression}`), expected);
  });
}

it("retains the source position when upstream selection changes the frame number", async () => {
  assert.equal(await render("select=eq(n\\,1),negate=enable=eq(pos\\,12)"), inverted.slice(24));
});

it("uses NaN for generated frames without a source packet position", async () => {
  const bypassed = await render("negate=enable=0", true);
  const enabled = await render("negate=enable=1", true);
  assert.notEqual(bypassed, enabled);
  assert.equal(await render("negate=enable=pos", true), bypassed);
  assert.equal(await render("negate=enable=isnan(pos)", true), enabled);
});
