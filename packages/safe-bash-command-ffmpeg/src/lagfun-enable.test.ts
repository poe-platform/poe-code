import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from("c8b4a08c0a0a0a0a0a0a0a0a0a0a0a0a", "hex");

async function run(filter: string, graph: boolean, source = input, destination = "pipe:1") {
  const volume = Volume.fromJSON({ "/in.raw": source, "/out.raw": "KEEP" });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
      "-video_size", "2x2", "-framerate", "1", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
      "-pix_fmt", "gray", "-f", "rawvideo", destination],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { chunks.push(data); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, stdout: Buffer.concat(chunks), volume };
}

// Native FFmpeg 7.0.2 reference bytes, with a fresh filesystem for each command.
for (const graph of [false, true]) {
  for (const [filter, hex] of [
    ["lagfun=decay=1:enable=between(n\\,1\\,2)", "c8b4a08cc8b4a08cc8b4a08c0a0a0a0a"],
    ["lagfun=decay=1:enable=0", input.toString("hex")],
    ["lagfun=decay=1", "c8b4a08cc8b4a08cc8b4a08cc8b4a08c"],
    ["null", input.toString("hex")],
    ["lagfun=decay=1:enable='between(t,1,2)'", "c8b4a08cc8b4a08cc8b4a08c0a0a0a0a"],
    ["lagfun=decay=1:enable=0.25", input.toString("hex")],
    ["lagfun=decay=1:enable=-0.5", "c8b4a08cc8b4a08cc8b4a08cc8b4a08c"],
    ["lagfun=decay=1:enable='eq(st(0,ld(0)+1),4)'", "c8b4a08cc8b4a08c0a0a0a0a0a0a0a0a"]
  ] as const) {
    it(`honors ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const result = await run(filter, graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout.toString("hex"), hex);
      assert.deepEqual(result.volume.readFileSync("/in.raw"), input);
    });
  }

  it(`updates and decays history during disabled frames (${graph ? "graph" : "simple"})`, async () => {
    const source = Buffer.from([100, 0, 240, 0, 0].flatMap(value => Array(4).fill(value)));
    const result = await run("lagfun=decay=0.5:enable='eq(n,4)'", graph, source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, Buffer.from([100, 0, 240, 0, 60].flatMap(value => Array(4).fill(value))));
  });

  for (const expression of ["", "unknown", "between(n,1)", "1+"]) {
    it(`rejects invalid enable=${expression} without overwriting output (${graph ? "graph" : "simple"})`, async () => {
      const result = await run(`lagfun=enable='${expression}'`, graph, input, "/out.raw");
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.stdout.length, 0);
      assert.equal(result.volume.readFileSync("/out.raw", "utf8"), "KEEP");
    });
  }
}
