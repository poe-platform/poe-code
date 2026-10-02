import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4, parseMp4Boxes, hlsAst, dashAst, parseStreamingManifest, serializeDashDocument, MediaLimitExceededError } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 25, frameCount: 50, includeAudio: true }));

it("resolves HLS initialization files and preserves multiple fragments and packet payloads", () => {
  const resources = new Map<string, Uint8Array>();
  for (let i = 0; i < 2; i++) {
    // Keep source packets and absolute decode timestamps in each native-style fragment.
    const doc = { ...source, tracks: source.tracks.map(t => ({ ...t, samples: t.samples.filter(s => s.dts >= i * t.timescale && s.dts < (i + 1) * t.timescale) })) };
    const bytes = serializeMp4(doc, { fragmented: true });
    const offset = parseMp4Boxes(bytes).find(b => b.type === "moof")!.offset;
    if (i === 0) resources.set("init,video.mp4", bytes.slice(0, offset));
    resources.set(`part${i}.m4s`, bytes.slice(offset));
  }
  const playlist = encode('#EXTM3U\r\n#EXT-X-MAP:URI="init,video.mp4"\r\n#EXTINF:1,\r\npart0.m4s\r\n#EXTINF:1,\r\npart1.m4s\r\n#EXT-X-ENDLIST\r\n');
  const doc = hlsAst().parse(playlist, { resolveResource: uri => resources.get(uri)! });
  assert.equal(doc.tracks.length, 2);
  assert.equal(doc.tracks[0]!.width, 32);
  assert.equal(doc.tracks[0]!.samples.length, 50);
  assert.ok(doc.tracks[0]!.samples.every((s, i) => Buffer.from(s.data).equals(source.tracks[0]!.samples[i]!.data)));
  assert.equal(doc.tracks[0]!.duration / doc.tracks[0]!.timescale, 2);
});

it("round-trips DASH audio and video as parallel representations", () => {
  const { manifest, resources } = serializeDashDocument(source);
  const parsed = dashAst().parse(manifest, { resolveResource: uri => resources.get(uri)! });
  assert.equal(resources.size, 4);
  assert.equal(parsed.tracks.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(parsed.tracks[i]!.samples.map(s => s.data), source.tracks[i]!.samples.map(s => s.data));
  }
  assert.equal(parsed.tracks[0]!.duration / parsed.tracks[0]!.timescale, 2);
});

it("expands inherited DASH templates, start numbers, BaseURL and duration attributes", () => {
  const manifest = encode(`<MPD mediaPresentationDuration="PT1M2.5S"><BaseURL>media/</BaseURL><Period><AdaptationSet><SegmentTemplate timescale="10" duration="250" startNumber="7" initialization="init-$RepresentationID$.m4s" media="part-$Number%05d$.m4s"/><Representation id="v" width="128" height="96"/></AdaptationSet></Period></MPD>`);
  const plan = parseStreamingManifest(manifest, "dash");
  assert.equal(plan.durationSeconds, 62.5);
  assert.deepEqual(plan.sequences[0], [7, 8, 9].map(n => ({ uri: `media/part-${String(n).padStart(5, "0")}.m4s`, initialization: "media/init-v.m4s" })));
});

it("expands DASH timelines with Time, repeats, and a bounded negative repeat", () => {
  const manifest = encode(`<MPD mediaPresentationDuration="PT4S"><Period><AdaptationSet><Representation id="0"><SegmentTemplate timescale="1000" initialization="init.m4s" media="$Time$.m4s"><SegmentTimeline><S t="0" d="1000" r="1"/><S d="1000" r="-1"/></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet></Period></MPD>`);
  assert.deepEqual(parseStreamingManifest(manifest, "dash").sequences[0]!.map(s => s.uri), ["0.m4s", "1000.m4s", "2000.m4s", "3000.m4s"]);
  assert.throws(() => parseStreamingManifest(manifest, "dash", { limits: { maxConcatInputs: 2 } }), MediaLimitExceededError);
});

it("resolves DASH SegmentList resources", () => {
  const manifest = encode('<MPD mediaPresentationDuration="PT2S"><Period><AdaptationSet><Representation id="0"><BaseURL>parts/</BaseURL><SegmentList><Initialization sourceURL="init.m4s"/><SegmentURL media="one.m4s"/><SegmentURL media="two.m4s"/></SegmentList></Representation></AdaptationSet></Period></MPD>');
  assert.deepEqual(parseStreamingManifest(manifest, "dash").sequences[0], ["one", "two"].map(name => ({ uri: `parts/${name}.m4s`, initialization: "parts/init.m4s" })));
});

it("requires actual resources instead of returning synthetic playlist streams", () => {
  assert.throws(() => hlsAst().parse(encode('#EXTM3U\n#EXTINF:1,\npart.ts\n')), /resolveResource/);
  const { manifest } = serializeDashDocument(source);
  assert.throws(() => dashAst().parse(manifest), /resolveResource/);
  assert.throws(() => parseStreamingManifest(encode('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\npart.ts\n'), "hls"), /Encrypted HLS/);
  assert.throws(() => parseStreamingManifest(encode('#EXTM3U\n#EXTINF:1,\none.ts\n#EXTINF:1,\ntwo.ts\n'), "hls", { limits: { maxConcatInputs: 1 } }), MediaLimitExceededError);
});

it("reads native-style open-ended fMP4 edits without truncating sample duration or frame rate", () => {
  const track = source.tracks[0]!;
  const bytes = serializeMp4({ ...source, tracks: [{ ...track, editList: [
    { segmentDuration: 23, mediaTime: -1, mediaRateInteger: 1, mediaRateFraction: 0 },
    { segmentDuration: 0, mediaTime: 0, mediaRateInteger: 1, mediaRateFraction: 0 }
  ] }] }, { fragmented: true });
  const offset = parseMp4Boxes(bytes).find(b => b.type === "moof")!.offset;
  const resources = new Map([["init.mp4", bytes.slice(0, offset)], ["part.m4s", bytes.slice(offset)]]);
  const info = hlsAst().probe(encode('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\npart.m4s\n'), { resolveResource: uri => resources.get(uri)! });
  assert.equal(info.streams[0]!.r_frame_rate, "25/1");
  assert.ok(Number(info.streams[0]!.duration) >= 2);
});

it("bounds aggregate DASH output including the manifest and all representations", () => {
  const { manifest, resources } = serializeDashDocument(source);
  const total = manifest.length + [...resources.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  assert.throws(() => serializeDashDocument(source, { limits: { maxOutputBytes: total - 1 } }), MediaLimitExceededError);
});
