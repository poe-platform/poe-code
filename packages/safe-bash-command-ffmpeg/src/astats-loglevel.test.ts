import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: 2000 silent PCM16 samples followed by 400 samples at 16384.
const input = encodeWav({
  sampleRate: 8000,
  channels: [Float64Array.from({ length: 2400 }, (_, i) => i < 2000 ? 0 : 0.5)]
});

async function run(filter: string, level: string) {
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", level, "-guess_layout_max", "0", "-i", "/in.wav", "-af", filter, "-f", "s16le", "-"],
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
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr, volume };
}

for (const level of ["quiet", "error", "warning", "24", "info", "32", "verbose", "debug"]) {
  for (const metadata of [false, true]) {
    it(`astats respects log level ${level} with metadata=${metadata}`, async () => {
      const filter = metadata ? "astats=metadata=1,ametadata=mode=print:file=tags.txt" : "astats";
      const reference = await run(filter, "info");
      const actual = await run(filter, level);
      assert.equal(actual.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.stdout, reference.stdout);
      assert.equal(createHash("sha256").update(actual.stdout).digest("hex"), "f5cc9cb6b8345be6d8ab9db678c377dc610c2c685a07992b0dc87aca50d7a719");
      assert.ok(reference.stderr.includes("Channel: 1"));
      assert.equal(actual.stderr, ["quiet", "error", "warning", "24"].includes(level) ? "" : reference.stderr);
      if (metadata) {
        const tags = actual.volume.readFileSync("/tags.txt", "utf8");
        assert.ok(tags.includes("lavfi.astats.Overall.Number_of_samples="));
        assert.equal(tags, reference.volume.readFileSync("/tags.txt", "utf8"));
      }
    });
  }
}
