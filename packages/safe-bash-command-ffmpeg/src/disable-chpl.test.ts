import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Volume } from 'memfs';
import { createSyntheticMp4, parseMp4Boxes, parseMp4 } from '@poe-code/mp4-ast';
import { createFfmpegCommand, evalSyncFfmpeg } from './index.js';

for (const sync of [false, true]) {
  for (const [flags, disabled] of [
    [[], false],
    [['+disable_chpl'], true],
    [['+faststart+disable_chpl'], true],
    [['+disable_chpl', '-disable_chpl'], false],
    [['+disable_chpl', 'faststart'], false],
    [['disable_chpl-disable_chpl'], false]
  ] as const) {
    it(`keeps chapter samples and references for movflags=${flags.join(',')} (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({
        '/in.mp4': Buffer.from(createSyntheticMp4({ frameCount: 3, fps: 1, includeAudio: false })),
        '/meta': ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=A\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=3000\ntitle=B\n'
      });
      const args = ['-i', '/in.mp4', '-f', 'ffmetadata', '-i', '/meta', ...(sync ? [] : ['-map', '0:v']), '-map_chapters', '1', '-c', 'copy', ...flags.flatMap(flag => ['-movflags', flag]), '/out.mp4'];
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined, path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, '');
      } else {
        let stderr = '';
        const result = await createFfmpegCommand().execute({
          args, cwd: '/', env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const bytes = volume.readFileSync('/out.mp4') as Buffer;
      const moov = parseMp4Boxes(bytes).find(box => box.type === 'moov')!;
      const tracks = moov.children!.filter(box => box.type === 'trak');
      assert.equal(tracks.length, 2);
      const reference = tracks[0]!.children!.find(box => box.type === 'tref')?.children?.find(box => box.type === 'chap');
      assert.ok(reference);
      const parsed = parseMp4(bytes, { decodeSubtitles: false });
      assert.equal(new DataView(reference.payload.buffer, reference.payload.byteOffset).getUint32(0), parsed.tracks[1]!.id);
      assert.equal(moov.children!.find(box => box.type === 'udta')?.children?.some(box => box.type === 'chpl') ?? false, !disabled);
      assert.deepEqual(parsed.tracks[1]!.samples.map(sample => new TextDecoder().decode(sample.data.subarray(2))), ['A', 'B']);
    });
  }
}
