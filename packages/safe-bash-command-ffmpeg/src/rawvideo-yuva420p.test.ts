import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: string, format = "yuva420p", size = "2x4", filter = "null", maxOutputBytes?: number) {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex"), "/out.raw": "KEEP" });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxOutputBytes } }).execute({
    args: ["-y", "-hide_banner", "-nostats", "-v", filter.includes("showinfo") ? "info" : "error",
      "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", size, "-framerate", "4",
      "-i", "/in.raw", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format,
      "-f", "rawvideo", maxOutputBytes === undefined ? "pipe:1" : "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { stdout.push(data); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: Buffer.concat(stdout).toString("hex"), file: volume.readFileSync("/out.raw", "utf8") };
}

const input = "101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f";
const colored = "11589fe62d74bb024990d71e65acf33a81c80f569de42b72b900478ed51c63aa";

for (const [source, format, expected] of [
  [input, "yuva420p", "1e2225292c30333681817f7f13171b1f23272b2f"],
  [colored, "yuva420p", "5068809897af465faa5f5c9de7021e3a56728fab"],
  [colored, "rgba", colored]
]) {
  it(`writes native ${format} bytes for ${source}`, async () => {
    const result = await run(source!, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.output, expected);
  });
}

it("writes full-resolution alpha after odd-sized chroma for every frame", async () => {
  const result = await run("141e2880".repeat(18), "yuva420p", "3x3");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output, "282828282828282828868686867b7b7b7b818181818181818181".repeat(2));
});

it("preserves showinfo frame fields before output conversion", async () => {
  const control = await run(input.repeat(2), "rgba", "2x4", "null,showinfo");
  const result = await run(input.repeat(2), "yuva420p", "2x4", "null,showinfo");
  assert.equal(control.exitCode, 0, control.stderr);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(control.stderr.includes("[showinfo] n:"));
  assert.equal(result.stderr, control.stderr);
  assert.ok(result.stderr.includes("checksum:365003F0 plane_checksum:[365003F0] mean:[32] stdev:[9.2]"));
  assert.ok(result.stderr.includes("n:1 pts:1 pts_time:0.25 duration:1 duration_time:0.25 fmt:rgba"));
  assert.equal(result.output, "1e2225292c30333681817f7f13171b1f23272b2f".repeat(2));
});

it("includes alpha in cumulative output limits before replacing the destination", async () => {
  const result = await run(input.repeat(2), "yuva420p", "2x4", "null", 39);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.file, "KEEP");
});
