const success = stdout => ({ exitCode: stdout === '0\n' ? 1 : 0, stdout, stderr: '' });
const failure = (message, exitCode = 2) => ({ exitCode, stdout: '', stderr: `expr: ${message}\n` });
export const controls = [
  { id: 'nested-inactive-prefix-no-locale', args: ['1', '|', '(', '0', '|', 'length', 'index', 'HIDDEN', 'H', ')'], env: { LC_ALL: 'independent-unsupported' }, expected: success('1\n'), subjects: [], noEncode: ['HIDDEN', 'H'] },
  { id: 'inactive-substr-no-allocation-or-number', args: ['0', '&', 'substr', 'HIDDEN', '999', '999'], limits: { maxStringBytes: 1, maxNumericDigits: 1 }, expected: success('0\n'), subjects: [], noEncode: ['HIDDEN', '999'] },
  { id: 'nested-inactive-arity-still-errors', args: ['1', '|', '(', '0', '&', 'index', 'HIDDEN', ')'], expected: failure("syntax error: unexpected ')'"), subjects: [], noEncode: ['HIDDEN'] },
  { id: 'inactive-regex-plus-late-close', args: ['0', '&', '(', 'match', 'HIDDEN', '['], expected: failure("syntax error: expecting ')' after '['"), subjects: [], noEncode: ['HIDDEN'] },
  { id: 'nested-runtime-before-late-token', args: ['(', '(', '9', '/', '0', ')', ')', 'junk'], expected: failure('division by zero'), subjects: [] },
  { id: 'prefix-regex-before-late-token', args: ['length', 'match', 'a', 'a', 'junk'], expected: failure("syntax error: unexpected argument 'junk'"), subjects: ['a'] },
  { id: 'three-workers-once-encounter-order', args: ['(', 'a', ':', 'a', ')', '+', '(', 'b', ':', 'b', ')', '+', '(', 'c', ':', 'c', ')'], limits: { maxSteps: 20000 }, expected: success('3\n'), subjects: ['a', 'b', 'c'], sharedBudget: true },
  { id: 'active-then-inactive-then-active', args: ['(', 'a', ':', 'a', '|', 'match', 'HIDDEN', '[', ')', '+', '(', 'b', ':', 'b', ')'], expected: success('2\n'), subjects: ['a', 'b'], noEncode: ['HIDDEN', '['] },
  { id: 'abort-result-before-late-close', args: ['(', 'a', ':', 'a'], abort: 'after-result', expected: { rejected: 'caller' }, subjects: ['a'] },
  { id: 'abort-in-stdout-after-worker', args: ['a', ':', 'a'], sink: 'abort-stdout', expected: { rejected: 'caller' }, subjects: ['a'] },
  { id: 'await-stdout-after-worker', args: ['a', ':', 'a'], sink: 'delayed-stdout', expected: success('1\n'), subjects: ['a'] },
  { id: 'stdout-failure-no-regex-replay', args: ['a', ':', 'a'], sink: 'fail-stdout', expected: failure('execution or output failure', 3), subjects: ['a'] },
  { id: 'stderr-failure-after-regex', args: ['a', ':', 'a', 'junk'], sink: 'fail-stderr', expected: { rejected: 'sink' }, subjects: ['a'] },
  { id: 'inactive-prefix-node-limit', args: ['0', '&', '(', 'length', 'HIDDEN', ')'], limits: { maxNodes: 2 }, expected: failure('AST node limit exceeded', 3), subjects: [], noEncode: ['HIDDEN'] },
  { id: 'inactive-nested-parser-limit', args: ['0', '&', '(', '(', 'length', 'HIDDEN', ')', ')'], limits: { maxDepth: 2 }, expected: failure('parser depth limit exceeded', 3), subjects: [], noEncode: ['HIDDEN'] },
  { id: 'inactive-chain-structural-depth', args: ['1', '|', '(', '2', '+', '3', '+', '4', '+', '5', ')'], limits: { maxDepth: 3 }, expected: failure('parser depth limit exceeded', 3), subjects: [], noEncode: ['2', '3', '4', '5'] },
].map(control => ({ native: false, env: { LC_ALL: 'C' }, ...control }));
