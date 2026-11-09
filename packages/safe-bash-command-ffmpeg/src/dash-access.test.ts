import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseXml } from "@poe-code/xml-ast";
import { createFfmpegCommand } from "./index.js";

it("advertises native DASH segment access and switching flags through ffmpeg stream copy", async () => {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/av.mp4", readFileSync(new URL("../../mp4-ast/src/fixtures/dash-priming.mp4", import.meta.url)));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/av.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", "/out.mpd"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
      async rename(from: string, to: string) { volume.renameSync(from, to); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const period = parseXml(volume.readFileSync("/out.mpd", "utf8").toString())
    .children.find(node => node.localName === "Period")!;
  const sets = period.children.filter(node => node.localName === "AdaptationSet");
  assert.equal(sets.length, 2);
  for (const set of sets) {
    const attributes = Object.fromEntries(set.attributes.map(attribute => [attribute.localName, attribute.value]));
    assert.equal(attributes.startWithSAP, "1");
    assert.equal(attributes.segmentAlignment, "true");
    assert.equal(attributes.bitstreamSwitching, "true");
  }
});
