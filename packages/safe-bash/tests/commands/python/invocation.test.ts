import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePythonInvocation, PythonInvocationError } from '../../../src/commands/python/invocation.js';

for (const [args, expected] of [
  [['-BOOu', '-E', '-P', '-c', 'pass', '-I'], ['-B', '-O', '-O', '-u', '-E', '-P']],
  [['-Imhttp.server', '-O'], ['-I']],
  [['-Werror', '-W', 'ignore::UserWarning', 'script.py', '-O'], []],
  [['--', '-O'], []], [['-', '-O'], []], [[], []],
  [['-B', '--help', '-i'], ['-B']], [['-OVV'], ['-O']],
  [['-bsdvqRS', '-cpass'], ['-b', '-s', '-d', '-v', '-q', '-R', '-S']],
] as const) {
  test(`startup arguments stop at the execution boundary: ${JSON.stringify(args)}`, () => {
    assert.deepEqual(parsePythonInvocation(args, {}).startupArgs, [...expected, '-c', '']);
  });
}

for (const option of ['utf8', 'utf8=0', 'utf8=1', 'dev', 'warn_default_encoding', 'int_max_str_digits=0', 'int_max_str_digits=640']) {
  test(`explicit -X setting ${option} reaches native startup`, () => {
    assert.deepEqual(parsePythonInvocation(['-X', option, '-c', 'pass'], {}).startupArgs, ['-X', option, '-c', '']);
    assert.deepEqual(parsePythonInvocation(['-X' + option, '-c', 'pass'], {}).startupArgs, ['-X', option, '-c', '']);
  });
}

for (const args of [['-i'], ['-t'], ['-x'], ['-z'], ['--bad'], ['-X', 'unknown'], ['-X', 'utf8=2'], ['-X', 'dev=no'], ['-X', 'int_max_str_digits=12'], ['-X', 'int_max_str_digits=xyz'], ['-X', 'int_max_str_digits=2147483648'], ['-W'], ['-X'], ['-c'], ['-m']]) {
  test(`unsupported or incomplete invocation fails explicitly: ${JSON.stringify(args)}`, () => {
    assert.throws(() => parsePythonInvocation(args, {}), PythonInvocationError);
  });
}

test('environment is independently copied for runtime initialization', () => {
  const env = { EXAMPLE: 'value' };
  const parsed = parsePythonInvocation(['-E', '-c', 'pass'], env);
  env.EXAMPLE = 'changed';
  assert.deepEqual(parsed.env, { EXAMPLE: 'value', PYTHONINSPECT: '' });
});

test('canonical path environment is deferred until the filesystem is mounted', () => {
  assert.deepEqual(parsePythonInvocation([], {PYTHONPATH:'/work', PYTHONWARNINGS:'error', OTHER:'yes'}).env, {OTHER:'yes', PYTHONINSPECT:''});
});

for (const variable of ['PYTHONINSPECT', 'PYTHONHOME']) {
  test(`${variable} fails explicitly unless native environment handling is disabled`, () => {
    assert.throws(() => parsePythonInvocation(['-c', 'pass'], { [variable]: 'enabled' }), PythonInvocationError);
    assert.doesNotThrow(() => parsePythonInvocation(['-E', '-c', 'pass'], { [variable]: 'enabled' }));
    assert.doesNotThrow(() => parsePythonInvocation(['-I', '-c', 'pass'], { [variable]: 'enabled' }));
    assert.doesNotThrow(() => parsePythonInvocation(['-c', 'pass'], { [variable]: '' }));
  });
}

test('startup suppresses the Pyodide default interactive inspect mode', () => {
  assert.equal(parsePythonInvocation([], {}).env.PYTHONINSPECT, '');
  assert.equal(parsePythonInvocation(['-I'], { PYTHONINSPECT: '1' }).env.PYTHONINSPECT, '');
});

for (const value of ['+640', '-0', ' 640', '\t+640']) {
  test(`native signed decimal -X value is accepted: ${JSON.stringify(value)}`, () => {
    assert.deepEqual(parsePythonInvocation(['-X', 'int_max_str_digits=' + value], {}).startupArgs, ['-X', 'int_max_str_digits=' + value, '-c', '']);
  });
}

test('version flags continue option validation and preserve subsequent startup flags', () => {
  assert.throws(() => parsePythonInvocation(['-V', '-z'], {}), PythonInvocationError);
  assert.throws(() => parsePythonInvocation(['--version', '-c'], {}), PythonInvocationError);
  assert.deepEqual(parsePythonInvocation(['-VqV', '-O'], {}).startupArgs, ['-q', '-O', '-c', '']);
});

for (const args of [['--help'], ['-BhOi'], ['--version'], ['-VV'], ['-V', '-c', 'pass']]) {
  test(`informational invocation ignores execution-only environment restrictions: ${JSON.stringify(args)}`, () => {
    const parsed = parsePythonInvocation(args, { PYTHONHOME: '/unavailable', PYTHONINSPECT: '1' });
    assert.equal(parsed.env.PYTHONHOME, undefined);
    assert.equal(parsed.env.PYTHONINSPECT, '');
  });
}

for (const args of [['--', '--help'], ['-', '--version'], ['script.py', '-h'], ['-c', 'pass', '-V'], ['-m', 'module', '--help'], ['-W', '--help', '-c', 'pass']]) {
  test(`guest arguments and option operands do not enable informational mode: ${JSON.stringify(args)}`, () => {
    assert.throws(() => parsePythonInvocation(args, { PYTHONINSPECT: '1' }), PythonInvocationError);
  });
}
