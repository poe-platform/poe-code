import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { readVint } from "./containers/ebml.js";
import { parseMkv, serializeMkv } from "./containers/mkv.js";

// Native VP8 WebM: eight packets at 2 fps, keyframes at 0, 1, 2 and 3 seconds.
const source = parseMkv(new Uint8Array(readFileSync(new URL("./fixtures/mkv-keyframes.webm", import.meta.url))));

function elements(bytes: Uint8Array, start = 0, end = bytes.length) {
  const result: { id: number; start: number; data: number; end: number }[] = [];
  while (start < end) {
    const id = readVint(bytes, start, false)!;
    const size = readVint(bytes, start + id.length, true)!;
    const data = start + id.length + size.length;
    const next = size.unknownSize ? end : data + size.value;
    assert.ok(next <= end);
    result.push({ id: id.value, start, data, end: next });
    start = next;
  }
  return result;
}

for (const format of ["matroska", "webm"]) {
  for (const multipleClusters of [false, true]) {
    it(`indexes ${format} video keyframes with resolved block offsets across ${multipleClusters ? "multiple clusters" : "one cluster"}`, () => {
      const track = source.tracks[0]!;
      const tracks = [track, { ...track, id: 9 }].map((track, index) => ({
        ...track,
        samples: track.samples.map(sample => ({
          ...sample,
          pts: sample.pts * (multipleClusters ? 40 : 1) + index * 100,
          dts: sample.dts * (multipleClusters ? 40 : 1) + index * 100
        }))
      }));
      // Metadata before clusters must contribute to segment-relative positions.
      const doc = { ...source, tracks, metadata: { title: "Indexed clip", artist: "Test" },
        chapters: [{ id: 1, startTimeSeconds: 0, endTimeSeconds: 1, title: "Start" }],
        attachments: [{ tags: { filename: "note.txt", mimetype: "text/plain" }, data: new Uint8Array([42]), size: 1 }] };
      const bytes = serializeMkv(doc, { format });
      const segment = elements(bytes).find(element => element.id === 0x18538067)!;
      const children = (element: (ReturnType<typeof elements>)[number]) => elements(bytes, element.data, element.end);
      const uint = (element: (ReturnType<typeof elements>)[number]) =>
        bytes.subarray(element.data, element.end).reduce((value, byte) => value * 256 + byte, 0);
      const top = children(segment);
      const cues = top.find(element => element.id === 0x1c53bb6b);
      assert.ok(cues, "Cues must be present, independently of whether a player can scan packets");
      const seekHead = top.find(element => element.id === 0x114d9b74)!;
      assert.ok(seekHead, "SeekHead must locate the trailing index without scanning clusters");
      const seek = children(children(seekHead)[0]!);
      assert.equal(uint(seek.find(element => element.id === 0x53ab)!), 0x1c53bb6b);
      assert.equal(segment.data + uint(seek.find(element => element.id === 0x53ac)!), cues.start);
      const expected = tracks.flatMap((track, index) => track.samples.filter(sample => sample.isKeyframe)
        .map(sample => ({ time: sample.pts, track: index + 1, data: sample.data })))
        .sort((a, b) => a.time - b.time || a.track - b.track);
      assert.equal(children(cues).length, 8);
      const actual = children(cues).map(point => {
        const fields = children(point);
        const time = uint(fields.find(element => element.id === 0xb3)!);
        const positions = children(fields.find(element => element.id === 0xb7)!);
        const track = uint(positions.find(element => element.id === 0xf7)!);
        const clusterStart = segment.data + uint(positions.find(element => element.id === 0xf1)!);
        const cluster = top.find(element => element.start === clusterStart)!;
        assert.equal(cluster.id, 0x1f43b675);
        const blockStart = cluster.data + uint(positions.find(element => element.id === 0xf0)!);
        const block = children(cluster).find(element => element.start === blockStart)!;
        assert.equal(block.id, 0xa3);
        const payload = bytes.subarray(block.data, block.end);
        assert.equal(payload[0]! & 0x7f, track);
        assert.ok(payload[3]! & 0x80, "cue must target a keyframe");
        const clusterTime = uint(children(cluster).find(element => element.id === 0xe7)!);
        assert.equal(clusterTime + new DataView(payload.buffer, payload.byteOffset).getInt16(1), time);
        return { time, track, data: payload.subarray(4) };
      });
      assert.deepEqual(actual, expected);
      const packets = (tracks: typeof source.tracks) => tracks.map(track => track.samples.map(sample => ({
        pts: sample.pts, isKeyframe: sample.isKeyframe, data: sample.data
      })));
      assert.deepEqual(packets(parseMkv(bytes).tracks), packets(tracks));
      assert.equal(top.filter(element => element.id === 0x1f43b675).length > 1, multipleClusters);
    });
  }
}

it("resolves a keyframe cue to its BlockGroup when auxiliary video data is present", () => {
  const doc = parseMkv(new Uint8Array(readFileSync(new URL("./fixtures/vp9-alpha.webm", import.meta.url))));
  const bytes = serializeMkv(doc);
  const segment = elements(bytes).find(element => element.id === 0x18538067)!;
  const top = elements(bytes, segment.data, segment.end);
  const cues = top.find(element => element.id === 0x1c53bb6b);
  assert.ok(cues);
  const point = elements(bytes, cues.data, cues.end)[0]!;
  const position = elements(bytes, point.data, point.end).find(element => element.id === 0xb7)!;
  const fields = elements(bytes, position.data, position.end);
  const uint = (id: number) => {
    const field = fields.find(element => element.id === id)!;
    return bytes.subarray(field.data, field.end).reduce((value, byte) => value * 256 + byte, 0);
  };
  const cluster = top.find(element => element.start === segment.data + uint(0xf1))!;
  const block = elements(bytes, cluster.data, cluster.end).find(element => element.start === cluster.data + uint(0xf0))!;
  assert.equal(block.id, 0xa0);
  assert.deepEqual(parseMkv(bytes).tracks[0]!.samples.map(sample => sample.data), doc.tracks[0]!.samples.map(sample => sample.data));
});
