import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 negotiates unsigned PCM to signed PCM for astats.
for (const prefix of [
  "aformat=sample_fmts=u8",
  "aformat=sample_fmts=u8p",
  "aformat=sample_fmts=u8,aformat=sample_fmts=s16",
  "aformat=sample_fmts=s16"
]) {
  for (const metadata of [false, true]) {
    it(`uses signed PCM astats units after ${prefix} (${metadata ? "selection" : "report"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([0, 256, -512, 1024], value => value / 32768)
      ] }));
      const chunks: Buffer[] = [];
      let stderr = "";
      const filter = `${prefix},astats${metadata
        ? "=metadata=1,ametadata=select:key=lavfi.astats.Overall.Max_level:value=100:function=greater" : ""}`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", metadata ? "error" : "info", "-i", "/in.wav",
          "-af", filter, "-f", metadata ? "s16le" : "null", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      if (metadata) {
        assert.equal(Buffer.concat(chunks).toString("hex"), "0000000100fe0004");
        assert.equal(stderr, "");
      } else {
        const [channel, overall] = stderr.split("Overall\n");
        assert.ok(channel!.split("\n").includes("Channel: 1"), stderr);
        for (const section of [channel, overall]) {
          assert.ok(section?.split("\n").includes("Min level: -512.000000"), stderr);
          assert.ok(section?.split("\n").includes("Max level: 1024.000000"), stderr);
        }
      }
    });
  }
}
