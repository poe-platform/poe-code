import { describe, expect, it } from 'vitest';
import { validateManifestInvocation, type ManifestInvocation } from './protocol.js';

const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
const limits = { maxArguments: 10, maxArgvBytes: 100, maxPathBytes: 100 };
const fixture = (): ManifestInvocation => ({
  manifestId: 'manifest', manifestRevision: 'revision', directoryRevision: 'ready',
  cwd: bytes('/work/project'),
  originalArgv: [bytes('-i'), bytes('edit/lists/cut.ffconcat'), [], [255]],
});

describe.each([
  { name: 'direct SDK', transport: (value: ManifestInvocation): unknown => value },
  { name: 'REST JSON', transport: (value: ManifestInvocation): unknown => JSON.parse(JSON.stringify(value)) },
])('$name invocation admission without a tool parser or CLI', ({ transport }) => {
  it('preserves original byte arguments independently of manifest paths', () => {
    const input = transport(fixture());
    const before = JSON.stringify(input);
    validateManifestInvocation(input, limits);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(['manifestId', 'manifestRevision', 'directoryRevision'] as const)('requires %s', field => {
    const input = fixture();
    input[field] = '';
    expect(() => validateManifestInvocation(transport(input), limits)).toThrow(TypeError);
  });

  it.each(['destination', 'serverCwd', 'readAll', 'paths'])('rejects caller field %s', field => {
    const input = Object.assign(fixture(), { [field]: '/scratch/private' });
    expect(() => validateManifestInvocation(transport(input), limits)).toThrow(TypeError);
  });

  it('rejects missing argument and octet slots instead of changing argv', () => {
    const input = fixture();
    delete input.originalArgv[1];
    expect(() => validateManifestInvocation(transport(input), limits)).toThrow(TypeError);
    input.originalArgv = [[65, 66]];
    delete input.originalArgv[0][1];
    expect(() => validateManifestInvocation(transport(input), limits)).toThrow(TypeError);
  });

  it.each([[0], [256], [-1], [1.5]])('rejects invalid argument octets %j', argument => {
    const input = fixture();
    input.originalArgv = [argument];
    expect(() => validateManifestInvocation(transport(input), limits)).toThrow(TypeError);
  });

  it('requires an absolute NUL-free logical cwd within the byte limit', () => {
    for (const cwd of [[], bytes('work'), [47, 0], [47, ...Array<number>(100).fill(65)]]) {
      expect(() => validateManifestInvocation(transport({ ...fixture(), cwd }), limits)).toThrow(TypeError);
    }
  });

  it('bounds argument count and cumulative native argv bytes including terminators', () => {
    const input = fixture();
    input.originalArgv = [[], [255]];
    expect(() => validateManifestInvocation(transport(input), { ...limits, maxArguments: 2, maxArgvBytes: 3 })).not.toThrow();
    expect(() => validateManifestInvocation(transport(input), { ...limits, maxArguments: 1 })).toThrow(TypeError);
    expect(() => validateManifestInvocation(transport(input), { ...limits, maxArgvBytes: 2 })).toThrow(TypeError);
    input.originalArgv = [];
    expect(() => validateManifestInvocation(transport(input), { ...limits, maxArguments: 0, maxArgvBytes: 0 })).not.toThrow();
  });
});

it('rejects invalid invocation admission budgets', () => {
  for (const key of ['maxArguments', 'maxArgvBytes', 'maxPathBytes']) {
    for (const value of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => validateManifestInvocation(fixture(), { ...limits, [key]: value })).toThrow(TypeError);
    }
  }
  expect(() => validateManifestInvocation(fixture(), { ...limits, maxPathBytes: 0 })).toThrow(TypeError);
});
