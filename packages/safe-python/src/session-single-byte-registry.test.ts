import {expect, it} from 'vitest';
import {PythonSession} from './index.js';
import reference from './runtime/__snapshots__/single-byte-tables-3.14.7.json';

const literal = (points: readonly number[], bytes: boolean) => `${bytes ? 'b' : ''}'${points.map(point => bytes ? `\\x${point.toString(16).padStart(2, '0')}` : `\\U${point.toString(16).padStart(8, '0')}`).join('')}'`;

it.each([...new Set(reference.cases.map(row => row.name))])('publishes %s through the guest registry and incremental factories', name => {
  const session = new PythonSession({limits: {maxSteps: 10000000, maxAllocatedBytes: 64000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const check = (source: string) => {
    const result = session.exec(source);
    let detail: unknown = result;
    if (result.status === 'exception') {
      session.globals.set('failure', result.exception);
      detail = session.eval('str(failure)');
    }
    expect(result.status, JSON.stringify(detail)).toBe('ok');
  };
  check(`
import codecs
module = __import__('encodings.${name}', fromlist=['*'])
info = codecs.lookup('${name}')
assert codecs.lookup('${name}') is info
assert info.incrementalencoder is module.IncrementalEncoder
assert info.incrementaldecoder is module.IncrementalDecoder
assert info.streamreader is module.StreamReader
assert info.streamwriter is module.StreamWriter
`);
  for (const row of reference.cases.filter(row => row.name === name)) {
    const decode = row.operation === 'decode', input = literal(row.input, decode);
    const expected = row.expected;
    const operation = `codecs.${row.operation}(${input}, '${name}', ${JSON.stringify(row.policy)})`;
    if (expected.output !== undefined) {
      check(`
assert ${operation} == ${literal(expected.output, !decode)}
incremental = info.incremental${decode ? 'decoder' : 'encoder'}(${JSON.stringify(row.policy)})
source = ${input}
result = ${decode ? "''" : "b''"}
for chunk in (source[:1], source[1:128], source[128:]):
    result += incremental.${row.operation}(chunk, False)
result += incremental.${row.operation}(${decode ? "b''" : "''"}, True)
assert result == ${literal(expected.output, !decode)}
assert incremental.getstate() == ${decode ? "(b'', 0)" : '0'}
incremental.reset()
assert incremental.getstate() == ${decode ? "(b'', 0)" : '0'}
`);
    } else {
      check(`
try:
    ${operation}
except ${expected.error} as error:
${expected.object === undefined ? `    assert str(error) == ${JSON.stringify(expected.message)}` : `    assert error.object == ${literal(expected.object, decode)}
    assert (error.encoding, error.start, error.end, error.reason) == (${JSON.stringify(expected.encoding)}, ${expected.start}, ${expected.end}, ${JSON.stringify(expected.reason)})`}
else:
    assert False
`);
    }
  }
});
