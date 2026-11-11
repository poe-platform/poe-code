import { parseFfmetadata } from "@poe-code/mp4-ast";
import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const section of ["chapter", "Chapter", "CHAPTER"]) {
    it(`handles case-sensitive FFmetadata sections ${section} (${sync ? "sync" : "async"})`, async () => {
      const body = "START=100\nEND=500\ntitle=Intro";
      const chapter = "[CHAPTER]\nTIMEBASE=1/1000\n";
      const volume = Volume.fromJSON({
        "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000)] })),
        "/in.ffmeta": `;FFMETADATA1\n${chapter.replace("CHAPTER", section)}${body}\n`,
        "/out.ffmeta": "keep"
      });
      const args = ["-y", "-bitexact", "-v", "error", "-i", "/in.wav", "-f", "ffmetadata", "-i", "/in.ffmeta",
        "-map_metadata", "1", "-map_chapters", "1", "-f", "ffmetadata", "/out.ffmeta"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
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
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = volume.readFileSync("/out.ffmeta", "utf8") as string;
      const doc = parseFfmetadata(new TextEncoder().encode(output));
      assert.equal(doc.chapters?.length ?? 0, section === "CHAPTER" ? 1 : 0);
      assert.equal(doc.metadata.title, section === "CHAPTER" ? undefined : "Intro");
      if (section === "CHAPTER") {
        assert.equal(output, `;FFMETADATA1\n${chapter}${body}\n`);
      }
    });
  }
}
