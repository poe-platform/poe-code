import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string) {
  const fs = Volume.fromJSON({ "/in.raw": Buffer.from([40, 40, 100, 160, 200, 200, 240]), "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
      "-video_size", "1x1", "-framerate", "4", "-i", "/in.raw", "-vf", `${filter},showinfo`,
      "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: fs.readFileSync("/out.raw") as Buffer };
}

for (const threads of ["0", "1", "2", "1.5", "default", "min", "1+1"]) {
  it(`accepts thumbnail threads=${threads} without changing selected frames`, async () => {
    const result = await run(`thumbnail=n=3:threads=${threads}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), "28c8f0");
    assert.equal(result.stderr, "");
  });
}

for (const filter of ["thumbnail=3:threads=1", "thumbnail=threads=1:n=3", "thumbnail=n=3:log=quiet:threads=1", "thumbnail=3:quiet:threads=1", "thumbnail=threads=1"]) {
  it(`preserves the batch size for ${filter}`, async () => {
    const result = await run(filter);
    const control = await run(filter === "thumbnail=threads=1" ? "thumbnail" : "thumbnail=n=3");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(control.exitCode, 0, control.stderr);
    assert.deepEqual(result.output, control.output);
  });
}

for (const threads of ["-1", "2147483648", "nope", ""]) {
  it(`rejects invalid thumbnail threads=${threads} without overwriting output`, async () => {
    const result = await run(`thumbnail=n=3:threads=${threads}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("thumbnail"), result.stderr);
    assert.equal(result.output.toString(), "KEEP");
  });
}
