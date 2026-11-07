import assert from "node:assert/strict";
import { it } from "node:test";
import { buildAudioSpecificConfig, buildEsdsBox } from "./codecs.js";
import { createSyntheticMp4, parseMp4, serializeMp4, parseMp4Boxes, hlsAst, dashAst, parseStreamingManifest, serializeDashDocument, MediaLimitExceededError } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 25, frameCount: 50, includeAudio: true }));

for (const channels of [1, 2]) {
  it(`declares ${channels} audio channels inside the DASH audio representation`, () => {
    const input = parseMp4(createSyntheticMp4({ width: 32, height: 24, frameCount: 2, includeAudio: true, channels, sampleRate: 8000 }));
    const { manifest, resources } = serializeDashDocument(input);
    const representations = new TextDecoder().decode(manifest).split("<Representation ").slice(1);
    assert.equal(representations.length, 2);
    assert.ok(!representations[0]!.includes("AudioChannelConfiguration"));
    assert.ok(representations[1]!.includes(`audioSamplingRate="8000"`));
    assert.ok(representations[1]!.split("</Representation>")[0]!.includes(
      `<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${channels}"/>`
    ));
    const output = dashAst().parse(manifest, { resolveResource: uri => resources.get(uri)! });
    assert.equal(output.tracks[1]!.codecDescriptions[0]!.channels, channels);
    assert.deepEqual(output.tracks[1]!.samples.map(s => s.data), input.tracks[1]!.samples.map(s => s.data));
  });
}

for (const audioObjectType of [1, 2, 3]) {
  it(`advertises the copied AAC object type ${audioObjectType} in DASH`, () => {
    const track = source.tracks.find(t => t.type === "audio")!;
    const description = track.codecDescriptions[0]!;
    const config = description.esds!;
    const asc = buildAudioSpecificConfig(config.sampleRate, config.channelCount, audioObjectType);
    const input = parseMp4(serializeMp4({ ...source, tracks: [{ ...track, codecDescriptions: [{
      ...description,
      rawStsdEntryBytes: undefined,
      esds: { ...config, audioObjectType, decoderSpecificInfo: asc,
        rawEsdsBytes: buildEsdsBox(config.sampleRate, config.channelCount, config.avgBitrate, asc).subarray(8) }
    }] }] }));
    assert.equal(input.tracks[0]!.codecDescriptions[0]!.esds!.audioObjectType, audioObjectType);
    const { manifest, resources } = serializeDashDocument(input);
    assert.ok(new TextDecoder().decode(manifest).includes(`codecs="mp4a.40.${audioObjectType}"`));
    const output = dashAst().parse(manifest, { resolveResource: uri => resources.get(uri)! });
    assert.deepEqual(output.tracks[0]!.codecDescriptions[0]!.esds!.decoderSpecificInfo, asc);
    assert.deepEqual(output.tracks[0]!.samples.map(s => s.data), input.tracks[0]!.samples.map(s => s.data));
  });
}

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

for (const keyframeEvery of [4, 6]) {
  it(`splits DASH at duration targets on keyframes every ${keyframeEvery} frames`, () => {
    const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true }));
    const doc = { ...base, tracks: base.tracks.map(t => ({ ...t, samples: t.samples.map((s, i) => ({ ...s, isKeyframe: t.type === "audio" || i % keyframeEvery === 0 })) })) };
    const { manifest, resources } = serializeDashDocument(doc, { segmentDuration: 1 });
    const plan = parseStreamingManifest(manifest, "dash");
    assert.equal(plan.sequences[0]!.length, keyframeEvery === 4 ? 5 : 4);
    for (const [trackIndex, sequence] of plan.sequences.entries()) {
      const original = doc.tracks[trackIndex]!;
      const packets = sequence.flatMap(part => {
        const init = resources.get(part.initialization!)!;
        const media = resources.get(part.uri)!;
        const bytes = new Uint8Array(init.length + media.length);
        bytes.set(init); bytes.set(media, init.length);
        const track = parseMp4(bytes).tracks[0]!;
        assert.ok(track.samples[0]!.isKeyframe);
        return track.samples;
      });
      assert.deepEqual(packets.map(s => [s.dts, s.duration, s.data]), original.samples.map(s => [s.dts, s.duration, s.data]));
    }
    if (keyframeEvery === 4) assert.ok(new TextDecoder().decode(manifest).includes(`<S t="0" d="${doc.tracks[0]!.timescale}" r="4"/>`));
    const total = manifest.length + [...resources.values()].reduce((sum, b) => sum + b.length, 0);
    assert.throws(() => serializeDashDocument(doc, { segmentDuration: 1, limits: { maxOutputBytes: total - 1 } }), MediaLimitExceededError);
  });
}
