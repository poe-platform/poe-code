import { expect, it } from 'vitest';
import { discover } from './discover.js';

const b = (value: string) => new TextEncoder().encode(value);

it('keeps ffprobe input and output dash as descriptors after native handler rewriting', () => {
  const plan = discover('ffprobe', ['-i', '-', '-o', '-'].map(b));
  expect(plan.dependencies.map(dependency => [dependency.role, dependency.kind, dependency.literal])).toEqual([
    ['input', 'descriptor', undefined], ['output', 'descriptor', undefined],
  ]);
});

it('predicts seek scopes and independent output codec/map groups without probing streams', () => {
  const argv = ['-ss', '1', '-i', 'source.wav', '-ss', '2', '-map', '0:a?', '-map', '-0:v', '-c:a', 'pcm_s16le', 'first.wav', '-c:a:0', 'flac', 'second.flac'].map(b);
  const plan = discover('ffmpeg', argv);
  expect(plan.groups.map(group => [group.kind, group.target, group.options.map(option => [option.name, option.value])])).toEqual([
    ['input', b('source.wav'), [['ss', b('1')]]],
    ['output', b('first.wav'), [['ss', b('2')], ['map', b('0:a?')], ['map', b('-0:v')], ['c', b('pcm_s16le')]]],
    ['output', b('second.flac'), [['c', b('flac')]]],
  ]);
  expect(plan.dependencies.map(dependency => [dependency.value, dependency.access, dependency.stage])).toEqual([
    [b('source.wav'), 'read', 'input'], [b('first.wav'), 'write', 'output'], [b('second.flac'), 'write', 'output'],
  ]);
  expect(plan.deferred.filter(item => item.reason === 'stream-metadata').map(item => item.index)).toEqual([6, 8, 10, 13]);
  expect(plan.argv).toEqual(argv);
});

it('keeps empty and raw-byte operands, duplicate overwrite options and expanded names intact', () => {
  const raw = new Uint8Array([255, 46, 119, 97, 118]);
  const argv = [b('-y'), b('-n'), b('-y'), b('-i'), raw, b(''), b('expanded one.wav'), b('expanded two.wav')];
  const plan = discover('ffmpeg', argv);
  expect(plan.globals.map(option => option.name)).toEqual(['y', 'n', 'y']);
  expect(plan.dependencies.map(dependency => dependency.value)).toEqual([raw, b(''), b('expanded one.wav'), b('expanded two.wav')]);
  expect(plan.argv).toEqual(argv);
});

it('distinguishes literal presets, indirect filter scripts, URLs, descriptors and patterns', () => {
  const argv = ['-i', 'https://example.test/input?token=%FF', '-fpre', 'pipe:0', '-/filter:v:0', 'graph.option', '-/filter:a:0', 'audio.graph', '-map', '0:a?', '-f', 'image2', 'frame-%04d.ppm', '-f', 's16le', 'fd:'].map(b);
  const plan = discover('ffmpeg', argv);
  expect(plan.dependencies.map(dependency => [dependency.role, dependency.value, dependency.kind, dependency.access])).toEqual([
    ['input', b('https://example.test/input?token=%FF'), 'url', 'read'],
    ['preset', b('pipe:0'), 'path', 'read'],
    ['option-file', b('graph.option'), 'path', 'read'],
    ['option-file', b('audio.graph'), 'path', 'read'],
    ['output', b('frame-%04d.ppm'), 'pattern', 'write'],
    ['output', b('fd:'), 'descriptor', 'write'],
  ]);
  expect(plan.dependencies[2].optionReader).toEqual({ tool: 'ffmpeg', name: 'filter', specifier: b('v:0') });
  expect(plan.dependencies[3].optionReader).toEqual({ tool: 'ffmpeg', name: 'filter', specifier: b('a:0') });
  expect(plan.deferred).toContainEqual({ index: -1, reason: 'native-access' });
});

it('does not revive filter_script options removed from the pinned native grammar', () => {
  const plan = discover('ffmpeg', ['-i', 'source.wav', '-filter_script:a:0', 'audio.graph', 'out.wav'].map(b));
  expect(plan.dependencies.map(dependency => dependency.value)).toEqual([b('source.wav')]);
  expect(plan.deferred).toContainEqual({ index: 2, reason: 'unknown-option' });
});

it('predicts leading-dash inputs and protected outputs without rewriting their names', () => {
  const argv = ['-i', '-source.wav', '--', '-out.wav'].map(b);
  expect(discover('ffmpeg', argv).dependencies.map(dependency => dependency.value)).toEqual([b('-source.wav'), b('-out.wav')]);
});

it('leaves predictions after an unknown option to late native access', () => {
  const plan = discover('ffmpeg', ['-future-option', '-i', 'late.wav', 'partial.wav'].map(b));
  expect(plan.dependencies).toEqual([]);
  expect(plan.deferred).toContainEqual({ index: 0, reason: 'unknown-option' });
  expect(plan.deferred).toContainEqual({ index: -1, reason: 'native-access' });
});
