import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = Buffer.from("4080c0ff4080c0800a141e00ff002040", "hex");
const merged = Buffer.from("4080c0004080c0400a141e80ff0020ff", "hex");

async function execute(graph: string, options: {
  frames?: number; mask?: number[]; maskSize?: string; maskRate?: string; maskOffset?: string; map?: string; pipe?: boolean;
} = {}) {
  const volume = Volume.fromJSON({ "/out.raw": "existing output" });
  volume.writeFileSync("/in.raw", Buffer.concat(Array(options.frames ?? 1).fill(source)));
  volume.writeFileSync("/mask.raw", Buffer.from(options.mask ?? [0, 64, 128, 255]));
  const errors: Uint8Array[] = [];
  const stdout: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2", "-framerate", "4", "-i", "/in.raw",
      "-itsoffset", options.maskOffset ?? "0", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", options.maskSize ?? "2x2", "-framerate", options.maskRate ?? "4", "-i", "/mask.raw",
      ...(graph === "null" ? ["-vf", "null"] : ["-filter_complex", graph, "-map", options.map ?? "[out]"]),
      "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-bitexact", "-f", "rawvideo", options.pipe ? "pipe:1" : "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { ...result, output: options.pipe ? Buffer.concat(stdout) : volume.readFileSync("/out.raw"), stderr: Buffer.concat(errors).toString() };
}

it("alphamerge replaces existing alpha with the grayscale matte while retaining every RGB byte", async () => {
  const result = await execute("[0:v][1:v]alphamerge[out]", { pipe: true });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, merged);
});

it("null retains the original alpha", async () => {
  const result = await execute("null");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, source);
});

it("alphamerge repeats the final matte through the primary video's end", async () => {
  const result = await execute("[0:v:0][1:v:0]alphamerge[out]", { frames: 3 });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([merged, merged, merged]));
});

it("alphamerge synchronizes the matte by timestamp rather than frame index", async () => {
  const result = await execute("[0:v][1:v]alphamerge[out]", {
    frames: 3, maskRate: "2", mask: [0, 64, 128, 255, 255, 128, 64, 0]
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([merged, merged, Buffer.from("4080c0ff4080c0800a141e40ff002000", "hex")]));
});

it("alphamerge passes through primary frames before the matte starts", async () => {
  const result = await execute("[0:v][1:v]alphamerge[out]", { frames: 3, maskOffset: "0.25" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.concat([source, merged, merged]));
});

for (const [graph, options] of [
  ["[0:v][1:v]alphamerge[out]", { maskSize: "1x4" }],
  ["[0:v][2:v]alphamerge[out]", {}],
  ["[0:v][1:v]alphamerge[out]", { map: "[missing]" }],
  ["[0:v][1:v]alphamerge=unknown=1[out]", {}]
] as const) {
  it(`rejects invalid alphamerge input without replacing output: ${graph} ${JSON.stringify(options)}`, async () => {
    const result = await execute(graph, options);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "existing output");
  });
}
