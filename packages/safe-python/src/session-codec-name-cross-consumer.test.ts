import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import {codecNameCrossConsumerCases} from './codec-name-cross-consumer-cases.js';
import reference from './runtime/__snapshots__/codec-name-cross-consumer-services-3.14.7.json' with {type: 'json'};

it.each(codecNameCrossConsumerCases)('$name', ({name, source}) => {
  expect(reference.reference).toMatchObject({unicode: '16.0.0', platform: 'darwin', byteorder: 'little'});
  expect(reference.reference.version.startsWith('3.14.7 ')).toBe(true);
  const evidence = reference.cases.find(row => row.name === name)!;
  expect(evidence).toMatchObject({source, oracle: {status: 0, stderr: '', stdout: 'ok\n'}});
  // A second fresh interpreter must perform its own recovery for identical
  // program constants; no runtime value or cache is shared between sessions.
  for (let attempt = 0; attempt < 2; attempt++) {
    let output = '';
    const session = new PythonSession({hashSeed: [1n, 2n],
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
      output: {write(text) {output += text;}, flush() {}}
    });
    expect(session.exec(source)).toMatchObject({status: 'ok'});
    expect(output).toBe('ok\n');
  }
});
