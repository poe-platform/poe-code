import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: ERANGE, EINVAL, ENOSYS, and AVERROR_OPTION_NOT_FOUND.
for (const [option, exitCode] of [
  ["win_size=1023", 222], ["win_size=foo", 234],
  ["win_size=1025", 218], ["unknown=1", 8], ["win_size=1024", 0]
] as const) for (const graph of [false, true]) for (const output of ["pipe:1", "/out.pcm"]) {
  it(`surround=${option} matches native status and PCM (graph=${graph}, ${output})`, async () => {
    const fs = Volume.fromJSON({ "/out.pcm": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({
      sampleRate: 8000,
      channels: [0, 1].map(c => Float64Array.from({ length: 512 }, (_, i) =>
        (((i * 2 + c) * 13129) % 30001 - 15000) / 32768))
    }, { bitsPerSample: 16 }));
    const filter = `surround=${option}`;
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", output],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    const stdout = Buffer.concat(chunks);
    if (exitCode !== 0) {
      assert.ok(stderr.includes("surround"), stderr);
      assert.equal(stdout.length, 0);
      assert.equal(fs.readFileSync("/out.pcm", "utf8"), output !== "pipe:1" && exitCode === 218 ? "" : "keep");
    } else {
      const pcm = output === "pipe:1" ? stdout : fs.readFileSync(output) as Buffer;
      assert.equal(pcm.length, 6144);
      assert.equal(createHash("sha256").update(pcm).digest("hex"),
        "550746aadb7678511bce97d51278657234b327196c68034b132807ede73503d7");
    }
  });
}
