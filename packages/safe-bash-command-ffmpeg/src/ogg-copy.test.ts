import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAudio, readOgg } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const fixture of ["tone-opus", "vorbis"]) for (const extension of ["ogg", "opus"]) for (const sync of [false, true]) for (const pageDuration of fixture === "tone-opus" ? [undefined, 20000, 100000, 0] : [undefined]) {
  it(`${sync ? "sync" : "async"} copies ${fixture} packets and granules to .${extension} (page_duration=${pageDuration})`, async () => {
    const input = readFileSync(new URL(`./fixtures/${fixture}.ogg`, import.meta.url));
    const volume = Volume.fromJSON({ "/in.ogg": input });
    const output = `/out.${extension}`;
    const args = ["-y", "-v", "error", "-i", "/in.ogg", "-c", "copy", ...(pageDuration === undefined ? [] : ["-page_duration", String(pageDuration)]), output];
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
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    }
    const bytes = new Uint8Array(volume.readFileSync(output) as Buffer);
    if (fixture === "tone-opus") {
      const pages = readOgg(bytes).nodes;
      assert.equal(pages.length, pageDuration === 20000 ? 40 : pageDuration === 100000 ? 10 : 3);
      assert.equal(pages[0]!.fields!.flags, 2);
      assert.equal(pages.at(-1)!.fields!.flags, 4);
    }
    const headers = fixture === "vorbis" ? 3 : 2;
    assert.deepEqual(readOgg(bytes).packets.slice(headers).map(packet => packet.data), readOgg(input).packets.slice(headers).map(packet => packet.data));
    assert.equal(readOgg(bytes).packets.at(-1)!.granule, readOgg(input).packets.at(-1)!.granule);
    assert.equal(parseAudio(bytes).duration, parseAudio(input).duration);
    assert.deepEqual(parseAudio(bytes).tags, parseAudio(input).tags);
  });
}

it("copies eleven Opus packets for a 0.2 second output limit", () => {
  const input = readFileSync(new URL("./fixtures/tone-opus.ogg", import.meta.url));
  let output: Uint8Array | undefined;
  assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.ogg", "-t", "0.2", "-c", "copy", "/out.ogg"], undefined,
    () => input, (_path, bytes) => { output = bytes; return true; }), "");
  assert.deepEqual(readOgg(output!).packets.slice(2).map(packet => packet.data), readOgg(input).packets.slice(2, 13).map(packet => packet.data));
  assert.equal(readOgg(output!).packets.at(-1)!.granule, 10560n);
});
