import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "113a638cb5de07305982abd4fd264f78a1caf31c456e97c0";
const inverted = "eec59c734a21f8cfa67d542b02d9b0875e350ce3ba91683f";
const redGreen = "eec563734adef8cf597d54d402d94f875eca0ce3459168c0";

async function render(components: string, named = true) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
  volume.writeFileSync("/out.raw", "previous output");
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "2x2", "-r", "1",
      "-i", "/in.raw", "-vf", `negate=${named ? "components=" : ""}${components}`,
      "-pix_fmt", "rgb24", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), input);
  return { result, errors: Buffer.concat(errors).toString(), output: volume.readFileSync("/out.raw") as Buffer };
}

// Native FFmpeg 7.0.2 RGB24 reference bytes, including both frames.
for (const [components, expected] of [
  ["+r", inverted],
  ["-0", inverted],
  ["r+g-b", redGreen],
  ["r+g", redGreen],
  ["0", input],
  ["+0", inverted],
  ["r+g+b-b", redGreen],
  ["r-r+g+r", redGreen],
  ["r+g-r-g", input],
  ["-y-u-v-b", redGreen],
  ["-r+r", inverted]
] as const) {
  for (const named of [true, false]) {
    it(`applies ${named ? "named" : "positional"} negate flags ${components}`, async () => {
      const { result, errors, output } = await render(components, named);
      assert.equal(result.exitCode, 0, errors);
      assert.equal(output.toString("hex"), expected);
    });
  }
}

for (const components of ["+", "-", "r+", "r-", "r++g", "r--g", "r+-g", "r-bogus", "r+128", "-r", "+a"]) {
  it(`rejects invalid negate flags ${components}`, async () => {
    const { result, errors, output } = await render(components);
    assert.notEqual(result.exitCode, 0);
    assert.ok(errors.includes("negate:"), errors);
    const unavailable = components === "-r" || components === "+a" || components === "r+128";
    if (unavailable) assert.equal(result.exitCode, 234);
    assert.equal(output.toString(), unavailable ? "" : "previous output");
  });
}
