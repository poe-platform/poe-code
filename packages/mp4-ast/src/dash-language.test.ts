import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, dashAst, parseMp4, serializeDashDocument, serializeMp4 } from "./index.js";

for (const language of ["fra", "eng", "und", ""]) {
  it(`preserves DASH adaptation language ${JSON.stringify(language)} and copied audio`, () => {
    const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, frameCount: 2, includeAudio: true }));
    const source = parseMp4(serializeMp4({ ...base, tracks: base.tracks.map(track => ({
      ...track, language: track.type === "audio" ? language : "und"
    })) }));
    const { manifest, resources } = serializeDashDocument(source);
    const xml = new TextDecoder().decode(manifest);
    const audioSet = xml.split("<AdaptationSet").find(set => set.startsWith(' id="1"'))!;
    if (language && language !== "und") assert.ok(audioSet.includes(`lang="${language}"`), xml);
    else assert.ok(!audioSet.includes("lang="), xml);
    const output = dashAst().parse(manifest, { resolveResource: uri => resources.get(uri)! });
    assert.deepEqual(output.tracks.map(track => track.language), source.tracks.map(track => track.language));
    assert.deepEqual(output.tracks.map(track => track.samples.map(sample => sample.data)),
      source.tracks.map(track => track.samples.map(sample => sample.data)));
  });
}
