import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = await readFile(new URL("./fixtures/vibrato-timeline.wav", import.meta.url));
const warning = "output gain can cause saturation or clipping of output\n";

// Native FFmpeg PCM references; the clipping case also matches FFmpeg 7.0.2.
for (const graph of [false, true]) {
  for (const [levelArgs, warns] of [
    [[], true], [["-v", "warning"], true], [["-loglevel", "24"], true],
    [["-v", "error"], false], [["-loglevel", "quiet"], false]
  ] as const) {
    it(`chorus clipping warning at ${levelArgs.join(" ") || "default"} level (graph ${graph})`, async () => {
      for (const [options, clips, bytes, hash] of [
        ["1:1:10:0.9:1:1", true, 24176, "3d36c1967dea8d08300703edc0c37b0ab7cd37e17399ba09a4314af2f3ad108d"],
        ["in_gain=1:out_gain=1:delays=10:decays=0.9:speeds=1:depths=1", true, 24176, "3d36c1967dea8d08300703edc0c37b0ab7cd37e17399ba09a4314af2f3ad108d"],
        ["0.5:0.9:10:0.5:1:1", false, 24176, "bad7620893be73526670bb2f12731c25c945507e50377c18618d325d90bd6ef2"],
        ["0.5:1:10:1:1:1", false, 24176, "7b6d5999a489531c32b4e5397ca510c72e3ed64e306e35fed5b0b16c4783af50"],
        ["0:1:10:2:1:1", false, 24176, "9fdd3cb20c61117366da52986d56311008fec7b5aee9737e8dcebdc01bed7f27"],
        ["1:0:10:0.9:1:1", false, 24176, "3cc0dfa2d55f0e5610f9f0cdf393ab908d8f317ee43305b0363114fccfe48a7a"],
        ["0.5:1:10|20:0.5|0.6:1|2:1|2", true, 24352, "6b30ec5d0d0a44c59d09d50f486ef07af9e5dd89dc18ee910f3abbd4b925dc71"]
      ] as const) {
        const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
        volume.writeFileSync("/in.wav", input);
        let stderr = "";
        const filter = `chorus=${options}`;
        const result = await createFfmpegCommand().execute({
          args: [...levelArgs, "-y", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.pcm"],
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
        assert.equal(stderr, warns && clips ? warning : "", filter);
        const output = volume.readFileSync("/out.pcm") as Buffer;
        assert.equal(output.length, bytes, filter);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash, filter);
      }
    });
  }
}
