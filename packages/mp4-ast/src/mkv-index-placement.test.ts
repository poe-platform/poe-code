import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, serializeMkv } from "./containers/mkv.js";
import { readVint } from "./containers/ebml.js";

// FFmpeg VP8 fixture: eight packets at 2 fps, four keyframes one second apart.
const source = parseMkv(new Uint8Array(readFileSync(new URL("./fixtures/mkv-keyframes.webm", import.meta.url))));

function inspect(bytes: Uint8Array) {
  const elements = (start = 0, end = bytes.length) => {
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
  };
  const children = (element: ReturnType<typeof elements>[number]) => elements(element.data, element.end);
  const uint = (element: ReturnType<typeof elements>[number]) =>
    bytes.subarray(element.data, element.end).reduce((n, byte) => n * 256 + byte, 0);
  const segment = elements().find(element => element.id === 0x18538067)!;
  const top = children(segment);
  const clusters = top.filter(element => element.id === 0x1f43b675);
  const cues = top.find(element => element.id === 0x1c53bb6b)!;
  assert.ok(cues, "output has a cue index");
  const seekHead = top.find(element => element.id === 0x114d9b74)!;
  const seek = children(children(seekHead).find(element => element.id === 0x4dbb)!);
  assert.equal(segment.data + uint(seek.find(element => element.id === 0x53ac)!), cues.start);
  const times = children(cues).filter(element => element.id === 0xbb).map(point => {
    const fields = children(point);
    const positions = children(fields.find(element => element.id === 0xb7)!);
    const cluster = clusters.find(element => element.start === segment.data + uint(positions.find(field => field.id === 0xf1)!))!;
    assert.ok(cluster, "CueClusterPosition resolves after moving the index");
    const block = children(cluster).find(element => element.start === cluster.data + uint(positions.find(field => field.id === 0xf0)!))!;
    assert.equal(block.id, 0xa3);
    assert.ok(bytes[block.data + 3]! & 0x80);
    const time = uint(fields.find(element => element.id === 0xb3)!);
    assert.equal(uint(children(cluster).find(element => element.id === 0xe7)!) + new DataView(bytes.buffer, bytes.byteOffset + block.data).getInt16(1), time);
    return time;
  });
  return { firstCluster: clusters[0]!.start - segment.data, cueOffset: cues.start - segment.data,
    cueSize: cues.end - cues.start, times, voids: top.filter(element => element.id === 0xec).map(element => element.end - element.start) };
}

for (const format of ["matroska", "webm"]) {
  for (const multipleClusters of [false, true]) {
    it(`places ${format} cues and reserves exact space across ${multipleClusters ? "multiple clusters" : "one cluster"}`, () => {
      const tracks = source.tracks.map(track => ({ ...track, samples: track.samples.map(sample => ({
        ...sample, pts: sample.pts * (multipleClusters ? 40 : 1), dts: sample.dts * (multipleClusters ? 40 : 1)
      })) }));
      const doc = { ...source, tracks };
      const packets = (bytes: Uint8Array) => parseMkv(bytes).tracks[0]!.samples.map(sample => [sample.pts, sample.isKeyframe, sample.data]);
      const control = serializeMkv(doc, { format });
      const tail = inspect(control);
      assert.ok(tail.cueOffset > tail.firstCluster);
      assert.deepEqual(serializeMkv(doc, { format, cuesToFront: false }), control);
      assert.deepEqual(serializeMkv(doc, { format, reserveIndexSpace: 0 }), control);
      for (const options of [{ cuesToFront: true }, { reserveIndexSpace: 512 },
        { reserveIndexSpace: 512, cuesToFront: false }, { reserveIndexSpace: 16, cuesToFront: true },
        { reserveIndexSpace: 512, cuesToFront: true }]) {
        const bytes = serializeMkv(doc, { format, ...options });
        const output = inspect(bytes);
        assert.ok(output.cueOffset < output.firstCluster);
        assert.deepEqual(output.times, [0, 1000, 2000, 3000].map(time => time * (multipleClusters ? 40 : 1)));
        assert.deepEqual(packets(bytes), packets(control));
        if (options.reserveIndexSpace === 512) {
          assert.equal(output.firstCluster - tail.firstCluster, 512);
          assert.deepEqual(output.voids, [512 - output.cueSize]);
        } else {
          assert.equal(output.firstCluster - tail.firstCluster, output.cueSize);
        }
      }
      assert.throws(() => serializeMkv(doc, { format, reserveIndexSpace: 16 }), /reserve_index_space|reserved.*space/i);
      const front = inspect(serializeMkv(doc, { format, cuesToFront: true }));
      // A one-byte remainder cannot hold an EBML Void; absorb it into the Cues size field.
      for (const remainder of [0, 1, 2, 129, 130]) {
        const reserved = inspect(serializeMkv(doc, { format, reserveIndexSpace: front.cueSize + remainder }));
        assert.equal(reserved.firstCluster - tail.firstCluster, front.cueSize + remainder);
      }
    });
  }
}

it("validates Matroska reservation size and rejects oversized allocation before allocating", () => {
  for (const reserveIndexSpace of [-1, 1.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => serializeMkv(source, { reserveIndexSpace }), /Invalid reserve_index_space/);
  }
  for (const limits of [{ maxOutputBytes: 50000 }, { maxMemoryBytes: 50000 }]) {
    assert.throws(() => serializeMkv(source, { reserveIndexSpace: 2147483647, limits }), /limit/i);
  }
});

it("counts the complete reserved Matroska output against its byte limit", () => {
  const bytes = serializeMkv(source, { reserveIndexSpace: 512 });
  assert.throws(() => serializeMkv(source, { reserveIndexSpace: 512, limits: { maxOutputBytes: bytes.length - 1 } }), /limit/i);
  assert.deepEqual(serializeMkv(source, { reserveIndexSpace: 512, limits: { maxOutputBytes: bytes.length } }), bytes);
});
