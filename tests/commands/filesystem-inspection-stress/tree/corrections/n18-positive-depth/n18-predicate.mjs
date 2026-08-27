import assert from 'node:assert/strict';

const integer = '([+-]?\\d+)(?![\\w]|\\.\\d)';
const positiveInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const nonnegativeInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const rules = [
  {
    expression: /\b(?:must|shall)\s+be\s+(?:a\s+)?(?:strictly\s+)?positive(?:\s+integer)?\b/giu,
    valid: () => true,
  },
  {
    expression: new RegExp(`\\b(?:must|shall)\\s+be\\s+(?:greater\\s+than|above|>)\\s*${integer}`, 'giu'),
    valid: (match) => nonnegativeInteger(match[1]),
  },
  {
    expression: new RegExp(`\\b(?:must|shall)\\s+be\\s+(?:at\\s+least|>=)\\s*${integer}`, 'giu'),
    valid: (match) => positiveInteger(match[1]),
  },
  {
    expression: new RegExp(`\\b(?:must|shall)\\s+be\\s+between\\s+${integer}\\s+and\\s+${integer}`, 'giu'),
    valid: (match) => positiveInteger(match[1]) && positiveInteger(match[2]) && Number(match[2]) >= Number(match[1]),
  },
  {
    expression: new RegExp(`\\b(?:valid|allowed|expected|required)\\s+range\\s*(?::|is)?\\s*${integer}\\s*(?:\\.\\.|-|to)\\s*${integer}`, 'giu'),
    valid: (match) => positiveInteger(match[1]) && positiveInteger(match[2]) && Number(match[2]) >= Number(match[1]),
  },
];

export function assertPositiveDepthFailure({ exitCode, stdout, stderr }) {
  assert.ok(Number.isInteger(exitCode) && exitCode > 0 && exitCode <= 255, 'N18 requires a nonzero command failure status');
  assert.ok(stdout instanceof Uint8Array && stderr instanceof Uint8Array, 'N18 checks byte stdout/stderr');
  assert.equal(stdout.byteLength, 0, 'N18 usage failure must not emit normal stdout');
  assert.ok(stderr.byteLength > 0 && stderr.byteLength <= 4096, 'N18 requires a bounded nonempty error diagnostic');
  const diagnostic = new TextDecoder('utf-8', { fatal: true }).decode(stderr).trim();
  const relevant = diagnostic.split(/\r?\n/u).filter((line) => /(?:^|[^\w-])-L(?=$|[^\w-])/u.test(line) || /\b(?:level|depth)\b/iu.test(line));
  assert.ok(relevant.length > 0, 'N18 diagnostic must identify -L, level, or depth');
  const constraints = [];
  for (const line of relevant) {
    for (const rule of rules) for (const match of line.matchAll(rule.expression)) constraints.push(rule.valid(match));
    if (/\b(?:zero|0)\s+(?:is\s+)?(?:allowed|valid|accepted)\b|\b(?:including|allowing)\s+(?:zero|0)\b|\bpositive\s+or\s+(?:zero|0)\b/iu.test(line)) constraints.push(false);
  }
  assert.ok(constraints.length > 0 && constraints.every(Boolean), 'N18 diagnostic must require a valid positive depth bound or range, excluding zero');
}
