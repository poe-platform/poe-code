import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeDashDocument, MediaLimitExceededError } from "./index.js";

it("accounts for the live manifest in the DASH output budget", () => {
  const doc = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 48, includeAudio: false }));
  const options = { lowLatency: true, targetLatency: 1.5, utcTimingUrl: "https://example.invalid/time?a=1&b=2" };
  const output = serializeDashDocument(doc, options);
  const liveManifest = output.publications().next().value!.manifest;
  const live = new TextDecoder().decode(liveManifest);
  assert.ok(live.includes('<Latency target="1500"/>'));
  assert.ok(live.includes('time?a=1&amp;b=2'));
  assert.ok(!new TextDecoder().decode(output.manifest).includes("<Latency"));
  const total = Math.max(output.manifest.length, liveManifest.length) + [...output.resources.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  assert.throws(() => [...serializeDashDocument(doc, { ...options, limits: { maxOutputBytes: total - 1 } }).publications()], MediaLimitExceededError);
  assert.doesNotThrow(() => [...serializeDashDocument(doc, { ...options, limits: { maxOutputBytes: total } }).publications()]);
});

it("combines latency and playback rates in one live service description", () => {
  const doc = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 48, includeAudio: false }));
  const output = serializeDashDocument(doc, { lowLatency: true, targetLatency: 1.5, utcTimingUrl: "https://example.invalid/time", minPlaybackRate: 0.9, maxPlaybackRate: 1.1 });
  const live = new TextDecoder().decode(output.publications().next().value!.manifest);
  assert.equal(live.split('<ServiceDescription').length - 1, 1);
  assert.ok(live.includes('<Latency target="1500"/><PlaybackRate min="0.90" max="1.10"/>'));
});
