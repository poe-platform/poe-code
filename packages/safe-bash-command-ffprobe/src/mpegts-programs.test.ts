import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand, evalSyncFfprobe } from './media.js';

// FFmpeg: two 0.05s sine inputs, AAC, -program program_num=101:st=0
// -program program_num=202:st=1 -f mpegts.
const bytes = new Uint8Array(readFileSync(new URL('./fixtures/programs.mpegts', import.meta.url)));

it.each([true, false])('reports TS program membership (show_programs=%s)', async showPrograms => {
  const args = ['-v', 'error', ...(showPrograms ? ['-show_programs'] : []),
    '-show_entries', 'program=program_id:stream=index,id,codec_name', '-of', 'json', '/input.ts'];
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input.ts', bytes);
  let output = '', diagnostic = '';
  const result = await createFfprobeCommand().execute({
    command: 'ffprobe', ...createCommandArguments(args), cwd: '/', env: {}, fs,
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  for (const text of [output, evalSyncFfprobe(undefined, args, () => bytes)!]) {
    const parsed = JSON.parse(text);
    expect(parsed.programs).toEqual([101, 202].map((id, index) => ({
      program_id: id,
      ...(showPrograms ? { tags: { service_name: `Service0${index + 1}`, service_provider: 'FFmpeg' } } : {}),
      streams: [{ index, id: `0x10${index}`, codec_name: 'aac' }]
    })));
    expect(parsed.streams).toEqual(parsed.programs.flatMap((p: { streams: unknown[] }) => p.streams));
  }
});

it('selects nested streams by their global ordinal even when index is hidden', () => {
  const parsed = JSON.parse(evalSyncFfprobe(undefined, ['-show_programs', '-select_streams', 'a:1',
    '-show_entries', 'program=program_id:program_tags=service_name:stream=id', '-of', 'json', '/input.ts'], () => bytes)!);
  expect(parsed.programs).toEqual([
    { program_id: 101, tags: { service_name: 'Service01' }, streams: [] },
    { program_id: 202, tags: { service_name: 'Service02' }, streams: [{ id: '0x101' }] }
  ]);
  expect(parsed.streams).toEqual([{ id: '0x101' }]);
});

it.each(['default', 'xml', 'ini', 'flat', 'csv', 'compact'])('prints program members in %s', writer => {
  const output = evalSyncFfprobe(undefined, ['-show_programs', '-show_entries', 'program=program_id:stream=id', '-of', writer, '/input.ts'], () => bytes)!;
  expect(output).toContain('101');
  expect(output).toContain('202');
  expect(output).toContain('Service01');
  expect(output).toContain('0x100');
  expect(output).toContain('0x101');
  if (writer === 'default') expect(output).toContain('[STREAM]\nid=0x100\n[/STREAM]\n[/PROGRAM]');
  if (writer === 'xml') expect(output).toContain('<stream id="0x100"/>');
  if (writer === 'flat') expect(output).toContain('programs.program.0.streams.stream.0.id="0x100"');
  if (writer === 'ini') expect(output).toContain('[programs.program.0.streams.stream.0]');
});

it('keeps programs empty for containers without programs', () => {
  const mp4 = new Uint8Array(readFileSync(new URL('../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4', import.meta.url)));
  const parsed = JSON.parse(evalSyncFfprobe(undefined, ['-show_programs', '-of', 'json', '/input.mp4'], () => mp4)!);
  expect(parsed.programs).toEqual([]);
});

it('reads every PMT instead of inferring the first program codec from PES', () => {
  const altered = bytes.slice();
  for (let offset = 0; offset + 188 <= altered.length; offset += 188) {
    const pid = ((altered[offset + 1]! & 31) << 8) | altered[offset + 2]!;
    if (pid === 0x1000) altered[offset + 17] = 3; // PMT elementary stream type: MPEG audio.
  }
  const parsed = JSON.parse(evalSyncFfprobe(undefined, ['-show_programs', '-of', 'json', '/input.ts'], () => altered)!);
  expect(parsed.programs[0]).toMatchObject({ program_id: 101, program_num: 101, pmt_pid: 4096, pcr_pid: 256, nb_streams: 1 });
  expect(parsed.programs[0].streams[0]).toMatchObject({ codec_name: 'mp3', id: '0x100' });
  expect(parsed.programs[1].streams[0]).toMatchObject({ codec_name: 'aac', id: '0x101' });
});
