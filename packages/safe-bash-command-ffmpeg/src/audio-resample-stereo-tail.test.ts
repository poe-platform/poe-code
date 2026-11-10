import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: stereo PCM16 at 48 kHz, including the flushed tail.
for (const [length, filter, bytes, hash, options] of [
  [128, "aresample=44100", 468, "ac359e5132aef7c6b816d677b0460d648cc89770f77797d44d14524341693bba"],
  [128, "earwax", 468, "1d7df01963600b1ce69c9a1192c4aa156ce881720cf801dbaa17097cc0adb8f2"],
  [2048, "aresample=44100", 7524, "e7d36286ecf99bbfc051b513ca121255d85b7a63d3d91283fc0b28f91a2bdb34"],
  [6144, "earwax", 22580, "729ed6eccb1ba5dea936bc36ff270d03d1c770fc440a77d29d9b7cef18d58027"],
  [6144, "aresample=44100,earwax", 22580, "729ed6eccb1ba5dea936bc36ff270d03d1c770fc440a77d29d9b7cef18d58027"],
  [128, "anull", 88, "9ca1ec024c57bc86ff0305474b291e9b73cf32d1ed05b6c1b2eea5f20f914b94", ["-ar", "8000", "-filter_size", "0"]],
  [128, "anull", 512, "920c38b356e4f187d1965198d8d8f9904c633a46abb11e6a750fb289369caf26"]
] as const) {
  it(`${filter} flushes ${length} stereo frames (${options?.join(" ") ?? "default"})`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 48000,
      channels: [0, 1].map(channel => Float64Array.from({ length }, (_, i) =>
        ((i * 421 + channel * 1709) % 12000 - 6000) / 32768)) }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", "-af", filter, ...options ?? [], "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, bytes);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
