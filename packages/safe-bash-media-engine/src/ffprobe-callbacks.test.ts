import { expect, it } from 'vitest';
import { discover } from './discover.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each([
  ['-i', 'first.wav', '-i', 'missing.wav', '-o', 'out.json'],
  ['first.wav', '-i', 'missing.wav', '-o', 'out.json'],
  ['-i', '', '-noi', 'missing.wav', '-o', 'out.json'],
  ['-i', 'first.wav', '-no/i:a', 'missing.wav', '-o', 'out.json'],
])('predicts only the retained input when the -i callback discards a duplicate: %j', (...args) => {
  const argv = args.map(b);
  const plan = discover('ffprobe', argv);
  expect(plan.argv).toEqual(argv);
  expect(plan.dependencies.map(item => [item.role, item.value])).toEqual([
    ['input', b(args[0] === 'first.wav' ? 'first.wav' : args[1])],
    ['output', b('out.json')],
  ]);
  expect(plan.deferred).toContainEqual({ index: -1, reason: 'native-access' });
});

it.each([
  ['-i', 'first.wav', 'missing.wav', '-o', 'unreachable.json'],
  ['first.wav', 'missing.wav', '-o', 'unreachable.json'],
  ['-i', 'first.wav', '--', '-missing.wav', '-o', 'unreachable.json'],
])('stops advisory parsing at a duplicate positional input: %j', (...args) => {
  const plan = discover('ffprobe', args.map(b));
  expect(plan.dependencies.map(item => [item.role, item.value])).toEqual([
    ['input', b('first.wav')],
  ]);
});

it('stops advisory parsing at the failing duplicate output callback', () => {
  const plan = discover('ffprobe', ['-o', 'first.json', '-no/o', 'second.json', '-i', 'unreachable.wav'].map(b));
  expect(plan.dependencies.map(item => [item.role, item.value])).toEqual([
    ['output', b('first.json')],
  ]);
});

it('retains an indirect input before later duplicate -i operands without reading its content', () => {
  const plan = discover('ffprobe', ['-/i', 'input.option', '-i', 'missing.wav', '-o', 'out.json'].map(b));
  expect(plan.dependencies.map(item => [item.role, item.value])).toEqual([
    ['option-file', b('input.option')], ['output', b('out.json')],
  ]);
});

it('predicts a duplicate slash output value read before its callback stops parsing', () => {
  const plan = discover('ffprobe', ['-o', 'first.json', '-/o', 'output.option', '-i', 'unreachable.wav'].map(b));
  expect(plan.dependencies.map(item => [item.role, item.value])).toEqual([
    ['output', b('first.json')], ['option-file', b('output.option')],
  ]);
});
