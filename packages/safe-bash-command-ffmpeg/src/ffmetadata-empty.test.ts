import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const title of ["title=", "title=one\ntitle=", "title=one"]) for (const sync of [false, true]) {
  it(`preserves global FFmetadata ${JSON.stringify(title)} (${sync ? "sync" : "async"})`, async () => {
    const input = `;FFMETADATA1\n${title}\nartist=Artist\n`;
    const volume = Volume.fromJSON({
      "/in.ffmeta": input, "/out.ffmeta": "keep",
      "/audio.wav": Buffer.from("UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQgAAAAAAOgDGPzQBw==", "base64")
    });
    const args = ["-y", "-v", "error", "-i", "/audio.wav", "-f", "ffmetadata", "-i", "/in.ffmeta", "-map_metadata", "1", "-map_chapters", "1", "-f", "ffmetadata", "/out.ffmeta"];
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
    const expectedTitle = title === "title=one" ? "one" : "";
    assert.equal(output, `;FFMETADATA1\ntitle=${expectedTitle}\nartist=Artist\nencoder=Lavf61.7.100\n`);
    const tags = Object.fromEntries(output.trim().split("\n").slice(1).map(line => line.split("=")));
    assert.equal(Object.hasOwn(tags, "title"), true);
    assert.equal(tags.title, expectedTitle);
    assert.equal(tags.artist, "Artist");
  });
}
