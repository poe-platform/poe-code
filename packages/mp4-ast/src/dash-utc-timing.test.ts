import assert from "node:assert/strict";
import { it } from "node:test";
import { parseXml } from "@poe-code/xml-ast";
import { createSyntheticMp4, parseMp4, serializeDashDocument } from "./index.js";

const source = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: false }));

for (const utcTimingUrl of [undefined, "", "https://example.invalid/time", 'https://example.invalid/time?a=1&b="<utc>"']) {
  it(`serializes DASH UTC timing ${JSON.stringify(utcTimingUrl)}`, () => {
    const baseline = serializeDashDocument(source);
    const output = serializeDashDocument(source, { utcTimingUrl });
    const mpd = parseXml(new TextDecoder().decode(output.manifest));
    const timing = mpd.children.filter(node => node.localName === "UTCTiming");
    assert.equal(timing.length, utcTimingUrl ? 1 : 0);
    if (utcTimingUrl) {
      assert.deepEqual(Object.fromEntries(timing[0]!.attributes.map(attribute => [attribute.localName, attribute.value])), {
        schemeIdUri: "urn:mpeg:dash:utc:http-xsdate:2014",
        value: utcTimingUrl
      });
    } else assert.deepEqual(output.manifest, baseline.manifest);
    assert.deepEqual(output.resources, baseline.resources);
  });
}
