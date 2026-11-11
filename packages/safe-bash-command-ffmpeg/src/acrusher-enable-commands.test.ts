import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Complete s16le output from native FFmpeg 7.0.2 for eight f64le samples.
for (const [filter, expected] of [
  ["asendcmd=c='0.0005 acrusher enable 0',acrusher=bits=2", "55a5552555a5552500a0002000a00020"],
  ["asendcmd=c='0.0005 acrusher enable 1',acrusher=bits=2:enable=0", "00a0002000a0002055a5552555a55525"],
  ["asendcmd=c='0.0005 acrusher bits 4',acrusher=bits=2", "55a5552555a5552511a1112111a11121"],
  ["acrusher=bits=2", "55a5552555a5552555a5552555a55525"],
  ["acrusher=bits=2:enable=0", "00a0002000a0002000a0002000a00020"],
  ["asendcmd=c='0.0005 acrusher enable invalid',acrusher=bits=2", "55a5552555a5552555a5552555a55525"],
  ["asendcmd=c='0.0005 acrusher enable invalid;0.0005 acrusher enable 1',acrusher=bits=2:enable=0", "00a0002000a0002055a5552555a55525"]
]) for (const complex of [false, true]) {
  it(`applies acrusher timeline commands: ${filter} (${complex ? "graph" : "simple"})`, async () => {
    const fs = createMemoryFileSystem();
    const input = Buffer.alloc(64);
    for (let i = 0; i < 8; i++) input.writeDoubleLE(i % 2 === 0 ? -0.75 : 0.25, i * 8);
    await fs.writeFile("/in.raw", input);
    const chunks: Buffer[] = [];
    let stderr = "";
    const graph = `asetnsamples=n=2:p=0,${filter}`;
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "f64le", "-ac", "1", "-ar", "8000", "-i", "/in.raw",
        ...(complex ? ["-filter_complex", `[0:a]${graph}[out]`, "-map", "[out]"] : ["-af", graph]),
        "-f", "s16le", "pipe:1"],
      command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(chunk) { chunks.push(Buffer.from(chunk)); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(Buffer.concat(chunks).toString("hex"), expected);
  });
}
