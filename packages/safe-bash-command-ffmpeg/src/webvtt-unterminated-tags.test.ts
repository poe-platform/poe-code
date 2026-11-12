import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Expected output bytes from native FFmpeg 7.0.2.
for (const [text, decoded] of [
  ["Price <unknown", "Price "],
  ["Price <unknown\nMore", "Price \n"],
  ["Price &lt;unknown", "Price <unknown"],
  ["Price <unknown &amp;shown", "Price &shown"],
  ["Price <unknown\\nMore", "Price "],
  ["Price <unknown>tail", "Price tail"]] as const) {
  for (const mode of ["srt", "webvtt", "copy"] as const) {
    for (const sync of [false, true]) {
      it(`${sync ? "sync" : "async"} ${mode} handles WebVTT tag text ${JSON.stringify(text)}`, async () => {
        const volume = Volume.fromJSON({
          "/in.vtt": `WEBVTT\n\n00:01.250 --> 00:03.500\n${text}\n\n`
        });
        const target = sync ? "/out" : "pipe:1";
        const args = ["-v", "error", "-i", "/in.vtt",
          ...(mode === "copy" ? ["-c:s", "copy"] : []),
          "-f", mode === "copy" ? "webvtt" : mode, target];
        let stdout = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
        }
        const expected = mode === "srt" ? `1\n00:00:01,250 --> 00:00:03,500\n${decoded.replaceAll("\n", "\r\n")}\n\n`
          : `WEBVTT\n\n00:01.250 --> 00:03.500\n${mode === "copy" ? text : decoded}\n`;
        assert.equal(sync ? volume.readFileSync(target, "utf8") : stdout, expected);
      });
    }
  }
}
