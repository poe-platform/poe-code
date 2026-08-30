import assert from 'node:assert/strict';

const integer = '([+-]?\\d+)(?![\\w]|\\.\\d)';
const positiveInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const nonnegativeInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const subject = '(?:tree:[ \\t]+)?(?:invalid[ \\t]+)?(-L|level|(?:maximum[ \\t]+)?depth)(?:,[ \\t]*|[ \\t]+)';
const profile = (constraint) => new RegExp(`^${subject}${constraint}[.]?$`, 'iu');
const rules = [
  {
    expression: profile('(?:must|shall)[ \\t]+be[ \\t]+(?:a[ \\t]+)?(?:strictly[ \\t]+)?positive(?:[ \\t]+integer)?'),
    valid: () => true,
  },
  {
    expression: profile(`(?:must|shall)[ \\t]+be[ \\t]+(?:greater[ \\t]+than|above|>)[ \\t]*${integer}`),
    valid: (match) => nonnegativeInteger(match[2]),
  },
  {
    expression: profile(`(?:must|shall)[ \\t]+be[ \\t]+(?:at[ \\t]+least|>=)[ \\t]*${integer}`),
    valid: (match) => positiveInteger(match[2]),
  },
  {
    expression: profile(`(?:must|shall)[ \\t]+be[ \\t]+between[ \\t]+${integer}[ \\t]+and[ \\t]+${integer}`),
    valid: (match) => positiveInteger(match[2]) && positiveInteger(match[3]) && Number(match[3]) >= Number(match[2]),
  },
  {
    expression: profile(`(?:valid|allowed|expected|required)[ \\t]+range[ \\t]*(?::|is)?[ \\t]*${integer}[ \\t]*(?:\\.\\.|-|to)[ \\t]*${integer}`),
    valid: (match) => positiveInteger(match[2]) && positiveInteger(match[3]) && Number(match[3]) >= Number(match[2]),
  },
];

export function assertPositiveDepthFailure({ exitCode, stdout, stderr }) {
  assert.ok(Number.isInteger(exitCode) && exitCode > 0 && exitCode <= 255, 'N18 requires a nonzero command failure status');
  assert.ok(stdout instanceof Uint8Array && stderr instanceof Uint8Array, 'N18 checks byte stdout/stderr');
  assert.equal(stdout.byteLength, 0, 'N18 usage failure must not emit normal stdout');
  assert.ok(stderr.byteLength > 0 && stderr.byteLength <= 4096, 'N18 requires a bounded nonempty error diagnostic');
  const diagnostic = new TextDecoder('utf-8', { fatal: true }).decode(stderr).trim();
  assert.ok(!/[\r\n\u2028\u2029]/u.test(diagnostic), 'N18 finite profile requires one complete diagnostic line');
  for (const rule of rules) {
    const match = diagnostic.match(rule.expression);
    if (!match) continue;
    assert.ok(!match[1].startsWith('-') || match[1] === '-L', 'N18 short option must be exactly -L');
    assert.ok(rule.valid(match), 'N18 diagnostic must exclude zero with valid ordered positive bounds');
    return;
  }
  assert.fail('N18 diagnostic must wholly match a documented depth-subject constraint');
}
