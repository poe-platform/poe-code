import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { readOgg } from "@poe-code/audio-ast";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native Opus fixtures: Alice/eng (400 Hz) and Bob/fra (800 Hz), 31 packets each.
const cases = [
  { name: "both tracks", fixture: "opus-languages.ogg", options: ["-map", "0:a"], selected: [0, 1], languages: ["eng", "fra"] },
  { name: "second track", fixture: "opus-languages.ogg", options: ["-map", "0:a:1"], selected: [1], languages: ["fra"] },
  { name: "first track", fixture: "opus-languages.ogg", options: ["-map", "0:a:0"], selected: [0], languages: ["eng"] },
  { name: "single track", fixture: "opus-language.ogg", options: [], selected: [0], languages: ["eng"] },
  { name: "language override", fixture: "opus-language.ogg", options: ["-metadata:s:a:0", "language=deu"], selected: [0], languages: ["deu"] },
  { name: "selected language override", fixture: "opus-languages.ogg", options: ["-map", "0:a:1", "-metadata:s:a:0", "language=deu"], selected: [1], languages: ["deu"] },
  { name: "disabled metadata inheritance", fixture: "opus-language.ogg", options: ["-map_metadata", "-1"], selected: [0], languages: ["und"] }
];

for (const sync of [false, true]) for (const scenario of cases) {
  // The synchronous command supports automatic stream selection only.
  if (sync && scenario.options.includes("-map")) continue;
  it(`${sync ? "sync" : "async"} preserves Opus language when copying ${scenario.name} to Matroska`, async () => {
    const input = readFileSync(new URL(`./fixtures/${scenario.fixture}`, import.meta.url));
    const volume = Volume.fromJSON({ "/in.ogg": input });
    const args = ["-i", "/in.ogg", ...scenario.options, "-c", "copy", "/out.mkv"];
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
    const copied = parseMkv(new Uint8Array(volume.readFileSync("/out.mkv") as Buffer));
    assert.equal(copied.tracks.length, scenario.selected.length);
    const source = readOgg(input).packets;
    const serials = [...new Set(source.map(packet => packet.serial))];
    for (const [index, track] of copied.tracks.entries()) {
      const selected = scenario.selected[index]!;
      const packets = source.filter(packet => packet.serial === serials[selected]).slice(2);
      assert.equal(track.samples.length, 31);
      assert.deepEqual(track.samples.map(sample => sample.data), packets.map(packet => packet.data));
      assert.equal(track.metadata?.title, selected === 0 ? "Alice" : "Bob");
    }
    assert.deepEqual(copied.tracks.map(track => track.language), scenario.languages);
  });
}
