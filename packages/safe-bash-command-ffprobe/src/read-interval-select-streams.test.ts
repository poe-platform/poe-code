import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { wavAst, type MediaAstPlugin } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

// Native ffprobe results on these tracked fixtures, including the selected packet count.
for (const [fixture, selectors, index, pts] of [
  ["attachments.mkv", ["m:title:Bob", "m:language:fra", "m:TITLE:Bob", "1", "a:1"], 1, [0, 128]],
  ["mdhd-language-german.mp4", ["i:1", "#1", "i:0x1", "#0x1"], 0, [0, 512]],
  ["attachments.mkv", ["m:title:missing", "m:missing", "m:title:bob", "99"], 0, []],
] as const) {
  for (const selector of selectors) {
    for (const countsOnly of [false, true]) {
      it(`reads selected interval ${selector}, countsOnly=${countsOnly}`, async () => {
        const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}`, import.meta.url));
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", bytes);
        let output = "", diagnostic = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe",
          ...createCommandArguments(["-v", "error", "-select_streams", selector,
            "-read_intervals", "%+#2", "-count_packets", "-show_entries",
            `stream=index,nb_read_packets${countsOnly ? "" : ":packet=stream_index,pts:packet_side_data="}`,
            "-of", "json", "/input"]),
          cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() {} },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        expect(diagnostic).toBe("");
        const parsed = JSON.parse(output);
        expect(parsed.streams).toEqual(pts.length ? [{ index, nb_read_packets: String(pts.length) }] : []);
        expect(parsed.packets).toEqual(countsOnly ? undefined : pts.map(pts => ({ stream_index: index, pts })));
      });
    }
  }
}

it.each(["m:title:Selected", "i:77", "#77", "a:1"])("selects %s from one-shot metadata including packetless streams", async selector => {
  const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(2500)] });
  const probe = wavAst().probe(bytes, { showPackets: true });
  const plugin: MediaAstPlugin = { ...wavAst(), async probeRecords() {
    return { ...probe,
      streams: (async function* () {
        yield { ...probe.streams[0]!, index: 0 };
        yield { ...probe.streams[0]!, index: 1, id: "0x4d", tags: { title: "Selected" } };
      })(),
      packets: (async function* () {
        for (const packet of probe.packets!) yield { ...packet, stream_index: 1 };
      })()
    };
  } };
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.wav", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand({ asts: [plugin] }).execute({
    command: "ffprobe",
    ...createCommandArguments(["-select_streams", selector, "-read_intervals", "%+#1", "-count_packets",
      "-show_entries", "stream=index,nb_read_packets:packet=stream_index,pts", "-of", "json", "/input.wav"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  const parsed = JSON.parse(output);
  expect(parsed.streams).toEqual([{ index: 1, nb_read_packets: "1" }]);
  expect(parsed.packets).toEqual([{ stream_index: 1, pts: 0 }]);
});
