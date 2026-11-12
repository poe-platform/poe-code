import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

async function encode(options: string[], target = "pipe:1", input?: Buffer) {
  const volume = Volume.fromJSON({ "/out.y4m": "KEEP", ...(input ? { "/in.y4m": input } : {}) });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...(input ? ["-i", "/in.y4m"] :
      ["-f", "lavfi", "-i", "testsrc2=s=64x48:r=2:d=1"]), "-pix_fmt", "yuv420p",
      ...options, "-f", "yuv4mpegpipe", target],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume, output: target === "pipe:1" ? Buffer.concat(chunks) : volume.readFileSync(target) as Buffer };
}

for (const target of ["pipe:1", "/out.y4m"]) {
  it(`signals chroma sample locations without changing frames in ${target}`, async () => {
    const baseline = await encode([], target);
    assert.equal(baseline.result.exitCode, 0, baseline.stderr);
    const headerEnd = baseline.output.indexOf(10) + 1;
    assert.equal(baseline.output.subarray(0, headerEnd).toString(),
      "YUV4MPEG2 W64 H48 F2:1 Ip A1:1 C420jpeg XYSCSS=420JPEG\n");
    assert.equal(baseline.output.length - headerEnd, 2 * (6 + 64 * 48 * 3 / 2));
    for (const [location, chroma] of [
      ["left", "420mpeg2"], ["center", "420jpeg"], ["topleft", "420paldv"],
      ["1", "420mpeg2"], ["2", "420jpeg"], ["3", "420paldv"],
      ["0.5", "420jpeg"], ["2.5", "420jpeg"], ["7", "420jpeg"],
      ["unknown", "420jpeg"], ["unspecified", "420jpeg"], ["0", "420jpeg"],
      ["top", "420jpeg"], ["bottomleft", "420jpeg"], ["bottom", "420jpeg"]
    ] as const) {
      const { result, stderr, output } = await encode(["-chroma_sample_location", location], target);
      assert.equal(result.exitCode, 0, `${location}: ${stderr}`);
      const end = output.indexOf(10) + 1;
      assert.equal(output.subarray(0, end).toString(),
        `YUV4MPEG2 W64 H48 F2:1 Ip A1:1 C${chroma} XYSCSS=${chroma.toUpperCase()}\n`);
      assert.deepEqual(output.subarray(end), baseline.output.subarray(headerEnd));
    }
  });
}

it("uses the last matching chroma location and resets it for the next output", async () => {
  const { result, stderr, output, volume } = await encode([
    "-chroma_sample_location", "left", "-chroma_sample_location:v:0", "topleft",
    "-chroma_sample_location:v:1", "center", "-chroma_sample_location:a:0", "center",
    "-f", "yuv4mpegpipe", "/first.y4m"
  ]);
  assert.equal(result.exitCode, 0, stderr);
  assert.ok(volume.readFileSync("/first.y4m").toString().split("\n")[0]!.includes("C420paldv XYSCSS=420PALDV"));
  assert.ok(output.toString().split("\n")[0]!.includes("C420jpeg XYSCSS=420JPEG"));
});

for (const [value, status] of [["bogus", 234], ["-1", 222], ["2147483648", 222]] as const) {
  it(`rejects invalid chroma location ${value} before overwriting output`, async () => {
    const { result, stderr, output } = await encode(["-chroma_sample_location", value], "/out.y4m");
    assert.equal(result.exitCode, status, stderr);
    assert.ok(stderr.includes("chroma_sample_location"));
    assert.equal(output.toString(), "KEEP");
  });
}

it("keeps synchronous and asynchronous Y4M output metadata consistent", async () => {
  const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F25:1 Ip A1:1 C420jpeg\nFRAME\n"), Buffer.from([16, 50, 90, 235, 100, 150])]);
  const { result, stderr, output } = await encode(["-chroma_sample_location:0", "topleft"], "pipe:1", input);
  assert.equal(result.exitCode, 0, stderr);
  let syncOutput: Uint8Array | undefined;
  assert.equal(evalSyncFfmpeg(["-i", "/in.y4m", "-chroma_sample_location:0", "topleft", "/out.y4m"], undefined,
    path => path === "/in.y4m" ? input : undefined,
    (_path, bytes) => { syncOutput = bytes; return true; }), "");
  assert.deepEqual(Buffer.from(syncOutput!), output);
});
