import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(kind: "video" | "audio", options: string[]) {
  const input = kind === "video" ? Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])
    : Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 256));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.md5": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...(kind === "video"
      ? ["-f", "rawvideo", "-video_size", "2x2", "-pixel_format", "gray", "-framerate", "4"]
      : ["-f", "s16le", "-ar", "8000", "-ac", "1"]), "-i", "/in.raw", ...options],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { ...result, stderr, volume };
}

for (const kind of ["video", "audio"] as const) {
  for (const option of kind === "video" ? ["-enc_time_base", "-enc_time_base:v", "-enc_time_base:v:0"]
    : ["-enc_time_base", "-enc_time_base:a", "-enc_time_base:a:0"]) {
    for (const mode of ["filter", "demux", "0", "1/1000"]) {
      it(`${kind} ${option} ${mode} uses the selected clock without changing payloads`, async () => {
        const result = await run(kind, [
          ...(kind === "video" ? ["-vf", "settb=1/8", "-fps_mode", "passthrough"] : ["-af", "asettb=1/16000"]),
          option, mode, "-fflags", "+bitexact", "-f", "framemd5", "/out.md5",
          "-f", "framemd5", "/second.md5"
        ]);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = result.volume.readFileSync("/out.md5", "utf8") as string;
        const rate = mode === "1/1000" ? 1000 : kind === "video" ? mode === "filter" ? 8 : 4 : mode === "filter" ? 16000 : 8000;
        assert.ok(output.includes(`#tb 0: 1/${rate}\n`), output);
        const duration = kind === "video" ? rate / 4 : 512 * rate / 8000;
        const hashes = kind === "video" ? ["37b59afd592725f9305e484a5d7f5168", "a6b8537b97d58b417d3dfdd1030b15d2"]
          : ["b2ea9f7fcea831a4a63b213f41a8855b", "b2ea9f7fcea831a4a63b213f41a8855b"];
        assert.deepEqual(output.split("\n").filter(line => line.startsWith("0,")).map(line => line.split(",").map(field => field.trim())),
          hashes.map((hash, i) => ["0", String(i * duration), String(i * duration), String(duration), kind === "video" ? "4" : "1024", hash]));
        const second = result.volume.readFileSync("/second.md5", "utf8") as string;
        assert.ok(second.includes(`#tb 0: 1/${kind === "video" ? 4 : 8000}\n`), second);
      });
    }
  }
  it(`${kind} rejects bogus encoder clock without replacing output`, async () => {
    const result = await run(kind, ["-enc_time_base", "bogus", "-f", "framemd5", "/out.md5"]);
    assert.equal(result.exitCode, 234, result.stderr);
    assert.ok(result.stderr.includes("Invalid value for -enc_time_base: bogus"), result.stderr);
    assert.equal(result.volume.readFileSync("/out.md5", "utf8"), "KEEP");
  });
}

for (const [mode, paths] of [["filter", ["/frame0.png", "/frame2.png"]], ["demux", ["/frame0.png", "/frame1.png"]]] as const) {
  it(`image filenames use the ${mode} clock after settb`, async () => {
    const result = await run("video", ["-vf", "settb=1/8", "-fps_mode", "passthrough", "-enc_time_base", mode, "-frame_pts", "1", "/frame%d.png"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Object.keys(result.volume.toJSON()).filter(path => path.startsWith("/frame")).sort(), paths);
  });
}

for (const kind of ["video", "audio"] as const) {
  it(`${kind} filter clock follows a labeled filter graph`, async () => {
    const graph = kind === "video" ? "[0:v]settb=1/8[out]" : "[0:a]asettb=1/16000[out]";
    const result = await run(kind, ["-filter_complex", graph, "-map", "[out]", "-enc_time_base", "filter", "-f", "framemd5", "/out.md5"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = result.volume.readFileSync("/out.md5", "utf8") as string;
    assert.ok(output.includes(`#tb 0: 1/${kind === "video" ? 8 : 16000}\n`), output);
  });
}

it("filter clock preserves a non-unit rational", async () => {
  const result = await run("video", ["-vf", "settb=1001/30000", "-fps_mode", "passthrough", "-enc_time_base", "filter", "-f", "framemd5", "/out.md5"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const output = result.volume.readFileSync("/out.md5", "utf8") as string;
  assert.ok(output.includes("#tb 0: 1001/30000\n"), output);
});

it("stream copy retains the demux clock with an encoder clock option", async () => {
  const result = await run("audio", ["-c:a", "copy", "-enc_time_base", "1/16000", "-f", "framemd5", "/out.md5"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const output = result.volume.readFileSync("/out.md5", "utf8") as string;
  assert.ok(output.includes("#tb 0: 1/8000\n"), output);
});
