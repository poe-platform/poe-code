import { expect, it } from 'vitest';
import { discover } from './discover.js';

const b = (value: string) => new TextEncoder().encode(value);

it.each(['autorotate:v:0', 'noautorotate:v:0', 'no/autorotate:v:0'])(
  'defers operand-free stream selection for %s without consuming an input', name => {
    const argv = [`-${name}`, '-f', 'lavfi', '-i', 'testsrc2=size=16x16:duration=0.04',
      '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'].map(b);
    const plan = discover('ffmpeg', argv);
    expect(plan.argv).toEqual(argv);
    expect(plan.groups[0].options[0]).toMatchObject({ name: 'autorotate', specifier: b('v:0'), value: undefined });
    expect(plan.dependencies.map(item => [item.role, item.value])).toEqual([['output', b('pipe:1')]]);
    expect(plan.deferred).toContainEqual({ index: 0, reason: 'stream-metadata' });
  },
);
