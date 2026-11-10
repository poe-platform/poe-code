import { expect, it } from "vitest";
import { parseAudio, probeWavSource, readId3Text } from "./index.js";
import fixtures from "../../../tests/fixtures/media/wav-id3.json" with { type: "json" };

// Native FFmpeg fixtures, with only the PCM payload shortened to four samples.
for (const [name, hex] of Object.entries(fixtures)) {
  it(`reads embedded WAV ID3 and respects chunk order: ${name}`, async () => {
    const bytes = Buffer.from(hex, "hex");
    const expected = name === "before"
      ? { title: "RIFF title", artist: "RIFF artist" }
      : { title: "Title from ID3", artist: "Artist from ID3" };
    const source = { size: bytes.length, async read(offset: number, length: number) {
      expect(length).toBeLessThanOrEqual(16384);
      return bytes.subarray(offset, offset + length);
    } };
    expect(parseAudio(bytes).tags).toEqual(expected);
    expect((await probeWavSource(source)).tags).toEqual(expected);
    const tags: Record<string, string> = {};
    const result = await probeWavSource(source, { onTag: async span => {
      let value = "";
      if ("encoding" in span && "unsynchronized" in span) {
        for await (const text of readId3Text(source, span)) value += text;
      } else value = new TextDecoder().decode(bytes.subarray(span.offset, span.offset + span.length));
      tags[span.key] = value.split("\0")[0]!.trimEnd();
    } });
    expect(result.tags).toEqual({});
    expect(tags).toEqual(expected);
  });
}
