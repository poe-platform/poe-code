import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const start of [500, 100, 0]) {
    it(`handles chapter ${start}..100 without overwriting output on failure (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({
        "/audio.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] })),
        "/in.ffmeta": `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=${start}\nEND=100\ntitle=Chapter\n`,
        "/out.ffmeta": "keep"
      });
      const args = ["-v", "error", "-y", "-i", "/audio.wav", "-f", "ffmetadata", "-i", "/in.ffmeta",
        "-map_metadata", "1", "-map_chapters", "1", "-f", "ffmetadata", "/out.ffmeta"];
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, start > 100 ? undefined : "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, start > 100 ? 244 : 0, stderr);
        if (start > 100) assert.ok(stderr.includes("Chapter end time 100 before start 500"), stderr);
      }
      const output = volume.readFileSync("/out.ffmeta", "utf8") as string;
      if (start > 100) assert.equal(output, "keep");
      else assert.ok(output.includes(`START=${start}\nEND=100\n`), output);
    });
  }
}

for (const end of [2, 3]) {
  it(`returns native status and stdout for chapter 3..${end}`, async () => {
    const input = `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1\nSTART=3\nEND=${end}\ntitle=A\n`;
    const volume = Volume.fromJSON({ "/a.meta": input });
    let stdout = "";
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "a.meta", "-bitexact", "-f", "ffmetadata", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return volume.readFileSync(path); } },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, end < 3 ? 244 : 0, stderr);
    assert.equal(stdout, end < 3 ? "" : input);
    if (end < 3) assert.ok(stderr.includes("Chapter end time 2 before start 3"), stderr);
    else assert.equal(stderr, "");
  });
}
