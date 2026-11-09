import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMp4, probeMp4, probeMp4Source, type MediaProbePacket, type MediaProbeFrame } from './index.js';

// Native ffprobe reference: AMR decodes 160/320 samples even when the last
// packet's container duration is shorter. Edit-list skips trim the first frame.
for (const [band, samples, skip, count] of [['nb', 160, 50, 7], ['wb', 320, 80, 6]] as const) {
  for (const flat of [false, true]) for (const route of ['buffer', 'source']) {
    test(`AMR ${band} edit-list timing: flat=${flat}, ${route}`, async () => {
      const bytes = readFileSync(new URL(`./fixtures/amr-edit-${band}${flat ? '-flat' : ''}.3gp`, import.meta.url));
      const skipped = flat ? 0 : skip;
      const probe = route === 'buffer' ? probeMp4(bytes, { showPackets: true, showFrames: true, decodeAudio: false })
        : await probeMp4Source({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } },
          { showPackets: true, showFrames: true });
      const packets: MediaProbePacket[] = [], frames: MediaProbeFrame[] = [];
      for await (const row of probe.packets!) packets.push(row);
      for await (const row of probe.frames!) frames.push(row);
      assert.equal(packets.length, count);
      assert.equal(frames.length, count);
      for (let i = 0; i < count; i++) {
        const packet: import("./types.js").MediaProbePacket = packets[i]!;
        const frame: import("./types.js").MediaProbeFrame = frames[i]!;
        const duration = band === 'nb' && i === count - 1 ? 50 : samples;
        const trim = i === 0 ? skipped : 0;
        assert.equal(packet.pts, i * samples - skipped);
        assert.equal(packet.duration, duration);
        assert.deepEqual(packet.side_data_list, i === 0 && skipped ? [{
          side_data_type: 'Skip Samples', skip_samples: skipped, discard_padding: 0, skip_reason: 0, discard_reason: 0
        }] : undefined);
        assert.equal(frame.pts, i * samples - skipped + trim);
        assert.equal(frame.pkt_dts, frame.pts);
        assert.equal(frame.best_effort_timestamp, frame.pts);
        assert.equal(frame.pts_time, (frame.pts! / (samples * 50)).toFixed(6));
        assert.equal(frame.duration, duration - trim);
        assert.equal(frame.duration_time, ((duration - trim) / (samples * 50)).toFixed(6));
        assert.equal(frame.nb_samples, samples - trim);
      }
    });
  }
  test(`AMR ${band} edit lists preserve packet payloads`, () => {
    const edited = parseMp4(readFileSync(new URL(`./fixtures/amr-edit-${band}.3gp`, import.meta.url)), { decodeAudio: false });
    const flat = parseMp4(readFileSync(new URL(`./fixtures/amr-edit-${band}-flat.3gp`, import.meta.url)), { decodeAudio: false });
    assert.deepEqual(edited.tracks[0]!.samples.map(sample => sample.data), flat.tracks[0]!.samples.map(sample => sample.data));
  });
}
