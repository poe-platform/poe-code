import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeDashDocument, MediaLimitExceededError } from "./index.js";

it("accounts for the live manifest in the DASH output budget", () => {
  const doc = parseMp4(createSyntheticMp4({ width: 32, height: 24, frameCount: 4, includeAudio: false }));
  const options = { lowLatencyDash: true, targetLatency: 1.5, utcTimingUrl: "https://example.invalid/time?a=1&b=2" };
  const output = serializeDashDocument(doc, options);
  assert.ok(output.liveManifest);
  const live = new TextDecoder().decode(output.liveManifest);
  assert.ok(live.includes('<Latency target="1500"/>'));
  assert.ok(live.includes('time?a=1&amp;b=2'));
  assert.ok(!new TextDecoder().decode(output.manifest).includes("<Latency"));
  const total = output.manifest.length + output.liveManifest.length + [...output.resources.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  assert.throws(() => serializeDashDocument(doc, { ...options, limits: { maxOutputBytes: total - 1 } }), MediaLimitExceededError);
  assert.doesNotThrow(() => serializeDashDocument(doc, { ...options, limits: { maxOutputBytes: total } }));
});
