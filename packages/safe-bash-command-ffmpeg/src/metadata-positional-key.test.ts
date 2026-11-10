import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const luma = [[16, 16, 16, 16], [16, 16, 16, 32], [16, 16, 16, 16],
  [200, 200, 200, 200], [200, 200, 200, 200], [200, 200, 200, 200],
  [80, 80, 80, 80], [16, 16, 16, 16]];
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...luma.flatMap(ys => [Buffer.from("FRAME\n"), Buffer.from([...ys, ...Array<number>(8).fill(128)])])]);

async function run(options: string, graph = false) {
  const volume = Volume.fromJSON({ "/in.y4m": input, "/o.raw": "KEEP", "/stats.log": "KEEP" });
  let stderr = "";
  const filter = `signalstats,metadata=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-y", "-i", "in.y4m",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "o.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    }, stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(volume.readFileSync("/stats.log", "utf8"), "KEEP");
  return { result, output: volume.readFileSync("/o.raw") as Buffer, stderr };
}

for (const graph of [false, true]) {
  for (const options of ["print:lavfi.signalstats.YMIN", "print:key=lavfi.signalstats.YMIN", "mode=print:key=lavfi.signalstats.YMIN"]) {
    it(`prints the selected video metadata key: ${options} (graph=${graph})`, async () => {
      const { result, output, stderr } = await run(options, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 96);
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "4d240453b9d26c288a7fb339c50f2c0385b0484486434ef7365e15258e7a1278");
      assert.equal(stderr, luma.map((ys, index) =>
        `frame:${String(index).padEnd(4)} pts:${String(index).padEnd(7)} pts_time:${index / 4}\nlavfi.signalstats.YMIN=${Math.min(...ys)}\n`).join(""));
    });
  }
}

it("prints no records for a missing positional key", async () => {
  const { result, output, stderr } = await run("print:lavfi.missing");
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  assert.equal(output.length, 96);
});

for (const options of ["mode=print:lavfi.signalstats.YMIN", "print:lavfi.signalstats.YMIN:extra", "print:lavfi.signalstats.YMIN:unknown=1"]) {
  it(`rejects unsupported metadata arguments without replacing output: ${options}`, async () => {
    const { result, output, stderr } = await run(options);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("metadata:"), stderr);
    assert.equal(output.toString(), "KEEP");
  });
}
