import { expect, it } from 'vitest';
import { nativeArgumentText } from './native-process.js';

it('launches the same argument carriers whose lengths were admitted', () => {
  let reads = 0;
  const args = [[65]];
  Object.defineProperty(args, 0, { get: () => ++reads === 1 ? [65] : [66, 67] });
  expect(nativeArgumentText(args, 2)).toEqual(['A']);
  expect(reads).toBe(1);
});

it('does not iterate beyond an admitted argument length when an octet accessor grows it', () => {
  const argument = [65];
  Object.defineProperty(argument, 0, { get: () => {
    argument.push(66);
    return 65;
  } });
  expect(nativeArgumentText([argument], 2)).toEqual(['A']);
});

it('launches only the argument octets it validated', () => {
  let reads = 0;
  const argument = [65];
  Object.defineProperty(argument, 0, { get: () => ++reads === 1 ? 65 : 257 });
  expect(nativeArgumentText([argument])).toEqual(['A']);
  expect(reads).toBe(1);
});

it('refuses inherited tokens and octets instead of treating sparse arrays as dense', () => {
  const tokens = new Array<number[]>(1);
  Object.setPrototypeOf(tokens, Object.assign(Object.create(Array.prototype), { 0: [65] }));
  const octets = new Array<number>(1);
  Object.setPrototypeOf(octets, Object.assign(Object.create(Array.prototype), { 0: 65 }));
  for (const args of [tokens, [octets]]) expect(() => nativeArgumentText(args)).toThrow('Invalid native argv');
});
