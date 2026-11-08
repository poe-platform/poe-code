import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg image2 output for 4x4 red and blue frames, in Y/U/V order.
const planes = [[0x51, 0x5a, 0xf0], [0x29, 0xf0, 0x6e]];
for (const mode of ["sequence", "literal", "start-number", "default-format", "encode", "missing-chroma", "short-chroma"] as const) {
  it(`reads image2 Y/U/V input: ${mode}`, async () => {
    const volume = new Volume();
    const packets: Buffer[] = [];
    for (const [index, values] of planes.entries()) {
      for (const [plane, suffix] of ["Y", "U", "V"].entries()) {
        const data = Buffer.alloc(plane === 0 ? 16 : 4, values[plane]);
        volume.writeFileSync(`/plane0${index + 1}.${suffix}`, data);
        packets.push(data);
      }
    }
    if (mode === "missing-chroma") volume.unlinkSync("/plane02.U");
    if (mode === "short-chroma") volume.writeFileSync("/plane02.V", Buffer.alloc(3));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "image2", ...(mode === "default-format" ? [] : ["-pixel_format", "yuv420p"]), "-video_size", "4x4",
        ...(mode === "start-number" ? ["-start_number", "2"] : []),
        "-i", mode === "literal" ? "/plane01.Y" : "/plane%02d.Y", "-c:v", mode === "encode" ? "rawvideo" : "copy", "-f", "rawvideo", "/joined.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    if (mode === "missing-chroma" || mode === "short-chroma") {
      assert.notEqual(result.exitCode, 0);
      assert.equal(volume.existsSync("/joined.raw"), false);
      assert.ok(stderr.includes(mode === "missing-chroma" ? "plane02.U" : "plane02.Y"), stderr);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/joined.raw"), Buffer.concat(mode === "literal" ? packets.slice(0, 3) : mode === "start-number" ? packets.slice(3) : packets));
    }
  });
}
