import { expect, it } from 'vitest';
import { discover } from './discover.js';
import { discoverContent } from './content.js';
const b = (value: string) => new TextEncoder().encode(value);

it('does not use zero-flag AVOptions as command-line arity hints', () => {
  for (const tool of ['ffmpeg', 'ffprobe'] as const) {
    const argv = ['-pkt_timebase', '1/8000', '-i', 'missing.wav', 'out.wav'].map(b);
    const plan = discover(tool, argv);
    expect(plan.argv).toEqual(argv);
    expect(plan.dependencies).toEqual([]);
    expect(plan.deferred).toContainEqual({ index: 0, reason: 'unknown-option' });
    expect(plan.deferred).toContainEqual({ index: -1, reason: 'native-access' });
  }
});

it('continues grouped discovery after native no/slash boolean lookup', () => {
  const argv = ['-no/y', '-no/autorotate:v:0', '-i', '-source.wav', '--', '-out.wav'].map(b);
  const plan = discover('ffmpeg', argv);
  expect(plan.argv).toEqual(argv);
  expect(plan.globals).toMatchObject([{ name: 'y', fromFile: false }]);
  expect(plan.groups[0].options).toMatchObject([{ name: 'autorotate', specifier: b('v:0'), fromFile: false }]);
  expect(plan.dependencies.map(dependency => [dependency.role, dependency.value])).toEqual([
    ['input', b('-source.wav')], ['output', b('-out.wav')],
  ]);
  expect(plan.deferred.some(item => item.reason === 'unknown-option')).toBe(false);
});

it('resolves sequential no/slash definitions without loading an argument file', () => {
  const argv = ['-no/f', 'lavfi', '-no/i', 'movie=in.wav', '-no/o', 'out.json'].map(b);
  const plan = discover('ffprobe', argv);
  expect(plan.argv).toEqual(argv);
  expect(plan.dependencies.map(dependency => [dependency.role, dependency.value])).toEqual([
    ['filter-resource', b('in.wav')], ['output', b('out.json')],
  ]);
  expect(plan.globals[0]).toMatchObject({ name: 'f', fromFile: false, value: b('lavfi') });
  expect(discoverContent({ kind: 'preset', location: b('/preset'), content: b('no/attach=in.wav\n') }).dependencies).toMatchObject([
    { role: 'attachment', value: b('in.wav'), stage: 'runtime' },
  ]);
  expect(discover('ffmpeg', ['-no/attach', 'in.wav', 'out.mkv'].map(b)).dependencies).toEqual([]);
});

it('uses sequential non-boolean no-prefixed lookup inside presets', () => {
  const plan = discover('ffmpeg', ['-noss', '0.02', '-noattach', 'in.wav', 'out.mkv'].map(b), 'preset');
  expect(plan.groups[0].options.map(option => [option.name, option.value])).toEqual([
    ['ss', b('0.02')], ['attach', b('in.wav')],
  ]);
  expect(plan.dependencies.filter(dependency => dependency.role === 'attachment').map(dependency => dependency.value)).toEqual([b('in.wav')]);
  expect(discoverContent({ kind: 'preset', location: b('preset'), content: b('noattach=in.wav\n') }).dependencies).toMatchObject([
    { role: 'attachment', access: 'read', value: b('in.wav'), stage: 'runtime' },
  ]);
  expect(discover('ffmpeg', ['-noattach', 'in.wav', 'out.mkv'].map(b)).dependencies).toEqual([]);
});

it('retains the preset handler spelling that selects search instead of a literal fpre path', () => {
  const plan = discover('ffmpeg', ['-nofpre', 'nested', 'out.mkv'].map(b), 'preset');
  expect(plan.dependencies.find(dependency => dependency.role === 'preset')).toMatchObject({
    value: b('nested'), kind: 'resource-lookup', access: 'read',
  });
  expect(plan.deferred).toContainEqual({ index: 0, reason: 'preset-search' });
});

it('tracks ffprobe sequential no-prefixed non-boolean handlers and their arity', () => {
  const plan = discover('ffprobe', ['-nof', 'lavfi', '-noi', 'movie=in.wav', '-noo', 'out.json'].map(b));
  expect(plan.globals.map(option => [option.name, option.value])).toEqual([['f', b('lavfi')]]);
  expect(plan.dependencies.map(dependency => [dependency.role, dependency.value])).toEqual([
    ['filter-resource', b('in.wav')], ['output', b('out.json')],
  ]);
  expect(discover('ffmpeg', ['-noss', '1', '-i', 'in.wav', 'out.wav'].map(b)).dependencies).toEqual([]);
});

it('does not resolve inherited JavaScript properties as native options', () => {
  for (const tool of ['ffmpeg', 'ffprobe'] as const) for (const name of ['constructor', 'toString', '__proto__']) {
    const plan = discover(tool, [`-${name}`, 'missing.wav'].map(b));
    expect(plan.dependencies).toEqual([]);
    expect(plan.deferred).toContainEqual({ index: 0, reason: 'unknown-option' });
  }
});

it('keeps undeclared slash options out of FFmpeg split predictions', () => {
  const plan = discover('ffmpeg', ['-/probesize', 'size.txt', '-i', 'missing.wav', 'out.wav'].map(b));
  expect(plan.dependencies).toEqual([]);
  expect(plan.deferred).toContainEqual({ index: 0, reason: 'unknown-option' });
});
it('predicts ffprobe sequential slash reads even for names absent from the inventory', () => {
  for (const name of ['probesize', 'future_private_option']) {
    const plan = discover('ffprobe', [`-/${name}`, 'size.txt', 'in.wav'].map(b));
    expect(plan.dependencies.map(d => [d.role, d.value])).toEqual([
      ['option-file', b('size.txt')], ...(name === 'probesize' ? [['input', b('in.wav')]] : []),
    ]);
    expect(plan.dependencies[0].optionReader).toEqual({ tool: 'ffprobe', name, specifier: undefined });
  }
});
it('does not predict a slash boolean operand as an ffprobe input', () => {
  const plan = discover('ffprobe', ['-/show_streams', 'missing.txt', 'in.wav'].map(b));
  expect(plan.dependencies).toEqual([]);
});
it('keeps slash-prefixed no forms distinct from native boolean negation', () => {
  const argv = ['-/nostdin', 'value.txt', 'in.wav'].map(b);
  expect(discover('ffmpeg', argv).dependencies).toEqual([]);
  expect(discover('ffprobe', argv).dependencies[0]).toMatchObject({ role: 'option-file', value: b('value.txt'), optionReader: { name: 'nostdin' } });
});
it('keeps stream suffix stripping specific to codec AVOption lookup', () => {
  expect(discover('ffmpeg', ['-threads:a', '1', '-i', 'in.wav', 'out.wav'].map(b)).dependencies.map(d => d.value)).toEqual([b('in.wav'), b('out.wav')]);
  for (const name of ['probesize:a', 'sws_flags:v', 'resampler:a']) {
    expect(discover('ffmpeg', [`-${name}`, '1', '-i', 'in.wav', 'out.wav'].map(b)).dependencies).toEqual([]);
  }
});
it('uses sequential option application for slash private options inside presets', () => {
  const result = discoverContent({ kind: 'preset', location: b('/preset.ffpreset'), content: b('/probesize=size.txt\n') });
  expect(result.dependencies.map(d => [d.role, d.value])).toEqual([['option-file', b('size.txt')]]);
});
