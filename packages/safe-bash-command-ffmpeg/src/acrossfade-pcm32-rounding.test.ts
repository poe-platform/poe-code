import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Byte-exact references from FFmpeg 7.0.2, including the unfaded second-input tail.
for (const [secondFormat, outputFormat, expected] of [
  ["f64le", "s32le", "28812c0127d22e0126c387fec17fee12f6469a19bb641ce5bc24ce0c"],
  ["f64le", "f64le", "0000008012c8823f0000007022ed823f000000a0cd8387bf000000c17feec23f000000f6469ac93f000000459be3cabf00000078499cb93f"],
  ["s32le", "f64le", "0000008012c8823f0000007022ed823f000000a0cd8387bf000000a04dd2943f000000a0cd8387bf0000007022ed823f0000008012c8823f"]
]) {
  it(`acrossfade converts ${secondFormat} to PCM32 before fading (${outputFormat} output)`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/first.raw", Buffer.from("28812c0127d22e01b9a4cbfd8f6ee7037d6ee703", "hex"));
    volume.writeFileSync("/second.raw", Buffer.from(secondFormat === "f64le"
      ? "ae2afbae08fee0bf8b54185b0872da3fb5503239b533d33f1c446b459be3cabfbd564277499cb93f"
      : "7d6ee7038f6ee703b9a4cbfd27d22e0128812c01", "hex"));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s32le", "-ar", "8000", "-ac", "1", "-i", "/first.raw",
        "-f", secondFormat, "-ar", "8000", "-ac", "1", "-i", "/second.raw", "-filter_complex",
        "[0:a][1:a]acrossfade=ns=3:o=1:c1=tri:c2=tri[o]", "-map", "[o]", "-f", outputFormat, "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
  });
}
