import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const scope of ["global", "chapter"]) {
    it(`round-trips escaped FFmetadata keys (${scope}, ${sync ? "sync" : "async"})`, async () => {
      const tags = String.raw`a\=b=v\=q
ab=v\=q
a\\=value
a\\\=b=value
`;
      const input = ";FFMETADATA1\n" + (scope === "global" ? tags : "title=Album\n") +
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=3000\n" +
        (scope === "chapter" ? tags : "title=Intro\n") + "artist=Ada\n" +
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=3000\nEND=8000\ntitle=Body\ngenre=Talk\n";
      let previous = input;
      for (let pass = 0; pass < 2; pass++) {
        const volume = Volume.fromJSON({ "/in.meta": previous });
        const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.meta",
          "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
        let output = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          output = volume.readFileSync("/out.meta", "utf8") as string;
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        assert.equal(output, input);
        previous = output;
      }
    });
  }
}
