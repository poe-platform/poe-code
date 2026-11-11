import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [option, value] of [["-sub_charenc", "UTF-8"], ["-sub_charenc_mode", "ignore"]] as const) {
  for (const output of ["pipe:1", "/out.vtt"]) {
    for (const beforeInput of [false, true]) {
      it(`${option} ${beforeInput ? "decodes input" : "rejects output placement"} with ${output}`, async () => {
        const input = Buffer.from("1\n00:00:01,000 --> 00:00:03,000\nCafé €\n");
        const volume = Volume.fromJSON({ "/in.srt": input, "/out.vtt": "KEEP" });
        const args = ["-v", "error", "-y",
          ...(beforeInput ? [option, value, "-i", "/in.srt"] : ["-i", "/in.srt", option, value]),
          "-f", "webvtt", output];
        if (!beforeInput) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
          assert.equal(volume.readFileSync("/out.vtt", "utf8"), "KEEP");
        }
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, beforeInput ? 0 : 234, stderr);
        if (beforeInput) assert.equal(stderr, "");
        else assert.ok(stderr.includes(`Codec AVOption ${option.slice(1)}`) && stderr.includes("is not an encoding option"), stderr);
        const expected = Buffer.from("WEBVTT\n\n00:01.000 --> 00:03.000\nCafé €\n");
        assert.deepEqual(Buffer.concat(stdout), beforeInput && output === "pipe:1" ? expected : Buffer.alloc(0));
        assert.deepEqual(volume.readFileSync("/out.vtt"), beforeInput && output === "/out.vtt" ? expected : Buffer.from("KEEP"));
        assert.deepEqual(volume.readFileSync("/in.srt"), input);
      });
    }
  }
}
