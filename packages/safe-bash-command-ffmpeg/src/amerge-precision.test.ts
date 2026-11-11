import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const clips = {
  s16le: "0100fdff1b00",
  s32le: "01800100ff7fffff70110100",
  f32le: "7b142e3eae47e1bd3333b33e",
  f64le: "0f3560000000e03fa07652000000d0bfbd564277499cb93f",
  u8: "c38279"
};

// Byte-exact output captured from native FFmpeg 7.0.2, including passing controls.
for (const [left, right, expected] of [
  ["s16le", "s32le", "000000000000003f000000000000003f00000000000018bf00000000000000bf0000000000004b3f000000000000003f"],
  ["s32le", "f64le", "000000001000083f000080000000e03f000000002000f0be000080000000d0bf000000000017013f00000078499cb93f"],
  ["f32le", "f64le", "000000608fc2c53f000000000000e03f000000c0f528bcbf000000000000d0bf000000606666d63f00000080499cb93f"],
  ["u8", "s16le", "0000000000c0e03f0000000000000000000000000000903f00000000000080bf000000000000acbf0000000000000000"],
  ["u8", "s32le", "0000000000c0e03f0000000000000000000000000000903f00000000000080bf000000000000acbf0000000000000000"],
  ["u8", "f32le", "0000000000c0e03f000000000000c63f000000000000903f000000000000bcbf000000000000acbf000000000080d63f"],
  ["u8", "f64le", "0000000000c0e03f000000000000e03f000000000000903f000000000000d0bf000000000000acbf000000000000ba3f"],
  ["s16le", "f32le", "000000000000003f0000000000c3c53f00000000000018bf000000000028bcbf0000000000004b3f000000008066d63f"],
  ["f64le", "f64le", "0f3560000000e03f0f3560000000e03fa07652000000d0bfa07652000000d0bfbd564277499cb93fbd564277499cb93f"]
] as const) {
  it(`amerge converts ${left}/${right} before widening to float64`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/left", Buffer.from(clips[left], "hex"));
    volume.writeFileSync("/right", Buffer.from(clips[right], "hex"));
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", left, "-ar", "8000", "-ac", "1", "-i", "/left",
        "-f", right, "-ar", "8000", "-ac", "1", "-i", "/right",
        "-filter_complex", "[0:a][1:a]amerge=inputs=2[o]", "-map", "[o]", "-f", "f64le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
  });
}
