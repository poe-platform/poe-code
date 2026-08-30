const specimens = [];
function specimen(id, args, expected, jobs = 0, extra = {}) {
  specimens.push({ id, args, expected, jobs, ...extra });
}
function invalid(id, args, message, jobs = 0, extra = {}) {
  specimen(id, args, { exitCode: 2, stdout: '', stderr: `expr: ${message}\n` }, jobs, extra);
}
function valid(id, args, stdout, jobs = 0, extra = {}) {
  specimen(id, args, { exitCode: stdout === '0\n' || stdout === '\n' ? 1 : 0, stdout, stderr: '' }, jobs, extra);
}
const division = 'division by zero';
const trailing = "syntax error: unexpected argument 'x'";
invalid('root-counterexample', ['1', '/', '0', 'x'], division);
invalid('modulo-trailing', ['1', '%', '0', 'x'], division);
invalid('noninteger-trailing', ['bad', '+', '1', 'x'], 'non-integer argument');
invalid('left-error-before-next-operator-missing', ['1', '/', '0', '+'], division);
invalid('left-error-before-next-same-precedence', ['1', '/', '0', '*'], division);
invalid('left-error-before-skipped-syntax', ['1', '/', '0', '|', ')'], division);
invalid('group-runtime-before-missing-close', ['(', '1', '/', '0'], division);
invalid('group-runtime-before-wrong-close', ['(', '1', '/', '0', 'x'], division);
invalid('nested-runtime-before-close', ['length', '(', '1', '/', '0', 'x'], division);
invalid('prefix-first-argument-before-missing-second', ['index', '(', '1', '/', '0', ')'], division);
invalid('prefix-second-before-missing-third', ['substr', 'abc', '(', '1', '/', '0', ')'], division);
invalid('rhs-group-syntax-before-division', ['1', '/', '(', '0', 'x', ')'], "syntax error: expecting ')' instead of 'x'");
invalid('rhs-missing-before-division', ['1', '/'], "syntax error: missing argument after '/'");
invalid('rhs-higher-precedence-syntax-before-division', ['1', '/', '0', ':'], "syntax error: missing argument after ':'");
invalid('rhs-prefix-syntax-before-noninteger', ['bad', '+', 'length'], "syntax error: missing argument after 'length'");
invalid('rhs-closing-syntax-before-runtime', ['1', '/', ')'], "syntax error: unexpected ')'");
invalid('rhs-higher-precedence-runtime-first', ['bad', '+', '1', '/', '0'], division);
invalid('earlier-noninteger-before-later-division', ['bad', '*', '1', '+', '1', '/', '0'], 'non-integer argument');
invalid('regex-error-before-trailing', ['a', ':', '[', 'x'], 'Invalid regular expression', 1);
invalid('regex-error-before-close', ['(', 'a', ':', '['], 'Invalid regular expression', 1);
invalid('regex-error-before-later-missing', ['a', ':', '[', '+'], 'Invalid regular expression', 1);
invalid('regex-prefix-error-before-outer-arity', ['index', 'match', 'a', '['], 'Invalid regular expression', 1);
invalid('regex-success-before-trailing', ['a', ':', 'a', 'x'], trailing, 1);
invalid('regex-success-before-missing-close', ['(', 'a', ':', 'a'], "syntax error: expecting ')' after 'a'", 1);
invalid('regex-success-before-runtime', ['a', ':', 'a', '/', '0', 'x'], division, 1);
invalid('syntax-prevents-regex-submit', ['a', ':', '(', '[', 'x', ')'], "syntax error: expecting ')' instead of 'x'");
invalid('first-regex-before-second-syntax', ['match', '(', 'a', ':', 'a', ')', '('], "syntax error: missing argument after '('", 1);
valid('regex-two-once-in-order', ['(', 'a', ':', 'a', ')', '+', '(', 'b', ':', 'b', ')'], '2\n', 2);
invalid('first-regex-error-stops-second', ['(', 'a', ':', '[', ')', '+', '(', 'b', ':', 'b', ')'], 'Invalid regular expression', 1);
valid('skip-or-division', ['1', '|', '(', '1', '/', '0', ')'], '1\n');
valid('skip-and-division', ['0', '&', '(', '1', '/', '0', ')'], '0\n');
valid('skip-or-invalid-regex', ['1', '|', 'a', ':', '['], '1\n');
valid('skip-and-prefix-invalid-regex', ['0', '&', 'match', 'a', '['], '0\n');
invalid('skip-still-missing-close', ['1', '|', '(', '1', '/', '0'], "syntax error: expecting ')' after '0'");
invalid('skip-still-missing-operand', ['0', '&', 'a', ':'], "syntax error: missing argument after ':'");
invalid('skip-still-trailing', ['1', '|', 'a', ':', '[', 'x'], trailing);
invalid('skip-still-prefix-arity', ['1', '|', 'substr', 'a', '1'], "syntax error: missing argument after '1'");
valid('nested-skip-never-regex', ['1', '|', '(', '0', '|', 'match', 'a', '[', ')'], '1\n');
valid('active-then-skipped-regex', ['a', ':', 'a', '|', 'b', ':', '['], '1\n', 1);
valid('active-false-then-active-regex', ['a', ':', 'b', '|', 'b', ':', 'b'], '1\n', 2);
valid('left-associative-division', ['20', '/', '2', '/', '2'], '5\n');
valid('prefix-binds-before-colon', ['length', 'abc', ':', '3'], '1\n', 1);
valid('quoted-parenthesis', ['+', ')'], ')\n');
valid('leading-double-dash', ['--', '1', '+', '2'], '3\n');
valid('skip-no-prefix-locale-evaluation', ['1', '|', 'length', 'abc'], '1\n', 0, { env: { LC_ALL: 'unsupported-sequencing-profile' }, native: false, noEncode: ['abc'], classification: 'explicit user parse-only requirement; not GNU skipped-prefix implementation parity' });
valid('skip-no-substr-number-evaluation', ['1', '|', 'substr', 'abc', '999', '1'], '1\n', 0, { limits: { maxNumericDigits: 1 }, native: false, noEncode: ['abc', '999'], classification: 'explicit user parse-only requirement' });
function limit(id, args, limits, label) {
  specimen(id, args, { exitCode: 3, stdout: '', stderr: `expr: ${label} limit exceeded\n` }, 0, { limits, native: false });
}
limit('argument-admission-before-runtime', ['1', '/', '0', 'oversized'], { maxArgumentBytes: 3 }, 'aggregate argument bytes');
limit('node-limit-active', ['1', '+', '2'], { maxNodes: 2 }, 'AST node');
limit('node-limit-skipped', ['1', '|', '(', '1', '+', '2', ')'], { maxNodes: 4 }, 'AST node');
limit('parser-depth-skipped', ['1', '|', '(', '(', '1', ')', ')'], { maxDepth: 2 }, 'parser depth');
limit('ast-depth-left-chain', ['1', '+', '1', '+', '1'], { maxDepth: 2 }, 'AST depth');
limit('work-admission-before-runtime', ['1', '/', '0'], { maxSteps: 1 }, 'evaluation work');
limit('active-string-allocation', ['abc'], { maxStringBytes: 2 }, 'string allocation');
limit('numeric-conversion', ['12', '+', '1'], { maxNumericDigits: 1 }, 'numeric digits');
limit('output-limit', ['abc'], { maxOutputBytes: 3 }, 'output bytes');
limit('diagnostic-output-limit-new-control', ['1', 'x'], { maxOutputBytes: 4 }, 'output bytes');
specimen('shared-budget-two-jobs', ['(', 'a', ':', 'a', ')', '+', '(', 'b', ':', 'b', ')'], { exitCode: 0, stdout: '2\n', stderr: '' }, 2, { limits: { maxSteps: 10000 }, native: false, sharedBudget: true });
specimen('abort-before-admission', ['a', ':', 'a'], { rejected: true }, 0, { native: false, abort: 'before' });
specimen('abort-after-first-worker-result', ['(', 'a', ':', 'a', ')', '+', '(', 'b', ':', 'b', ')'], { rejected: true }, 1, { native: false, abort: 'after-result' });
specimen('abort-admitted-worker', ['a', ':', 'a'], { rejected: true }, 1, { native: false, abort: 'admitted' });
specimen('abort-during-evaluation-checkpoint', ['1', '+', '2', '+', '3'], { rejected: true }, 0, { native: false, abort: 'checkpoint' });
export const cases = Object.freeze(specimens);
export const oldCap = Object.freeze({ id: 'old-syntax-output-one-separate', args: ['1', 'x'], limits: { maxOutputBytes: 1 }, expected: { exitCode: 2, stdout: '', stderr: "expr: syntax error: unexpected argument 'x'\n" }, jobs: 0, native: false, classification: 'unchanged old cap assumption; separate red denominator, not a sequencing expectation' });
