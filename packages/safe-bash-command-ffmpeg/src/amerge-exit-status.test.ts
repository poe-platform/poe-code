import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, destination: string) {
  const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
  for (const name of ["a", "b"]) {
    volume.writeFileSync(`/${name}.pcm`, Buffer.from("0100fdff1b00", "hex"));
  }
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error",
      "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/a.pcm",
      "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/b.pcm",
      "-filter_complex", `[0:a][1:a]${filter}[o]`, "-map", "[o]", "-f", "s16le", destination],
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
  return { ...result, stderr, stdout: Buffer.concat(stdout), output: volume.readFileSync("/out.pcm") };
}

// Shell statuses and PCM captured with native FFmpeg 7.0.2.
for (const name of ["amerge", "amerge@pair"]) {
  for (const [options, exitCode] of [
    ["inputs=0", 222],
    ["inputs=0b10", 234],
    ["inputs=2:foo=1", 8],
    ["inputs=2:enable=1", 176]
  ] as const) {
    for (const destination of ["pipe:1", "/out.pcm"]) {
      it(`${name}=${options} returns ${exitCode} without writing ${destination}`, async () => {
        const result = await run(`${name}=${options}`, destination);
        assert.equal(result.exitCode, exitCode, result.stderr);
        assert.notEqual(result.stderr, "");
        assert.equal(result.stdout.length, 0);
        assert.equal(result.output.toString(), "KEEP");
      });
    }
  }

  it(`${name} preserves valid input-count expressions and merged PCM`, async () => {
    const result = await run(`${name}=inputs=min+1`, "pipe:1");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.toString("hex"), "01000100fdfffdff1b001b00");
  });
}
