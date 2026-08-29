# TREE-01: contextual `from`

## Scope and write claim

- Worktree: `/Users/kjopek/Workspace/poe-code-safejs-fixes`, branch `main`, starting HEAD `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc`.
- Production writes: `packages/safejs/src/parse/tokenizer.ts` and `packages/safejs/src/parse/parser.ts` only.
- New regression tests: `packages/safejs/src/parse/contextual-from.test.ts`.
- Necessary existing-test correction: `packages/safejs/src/parse/parser.test.ts` previously asserted rejection of the valid `import { x as from } from "name"`; use the genuinely reserved `return` alias instead. This additional test path was announced before editing; production write claims remain unchanged.
- Documentation: this file only. No interpreter, README, master-plan, original-repository, or Git mutations.
- Bootstrap the exact 38 `archiveReadPolicy.excludedPaths` in the original audit's `inventory-verification.json` before payload reads; additionally exclude the entire `security/` directory. Excluded payloads are neither read nor executed.

## Plan

1. Inspect TREE-01, the full original virtual-dom reconciliation source and fixture anchors, and AST/parser compatibility workflows.
2. Add failing lexer/parser/runtime regressions for ordinary `from` bindings and object keys, including division and supported import/export contexts.
3. Classify `from` as an identifier and require its contextual spelling at the import separator; preserve the supported grammar.
4. Run original bounded native algorithms against historical anchors before SafeJS; compare complete outputs without source rewrites.
5. Run focused regressions, parser and broader SafeJS suites, and typechecking. Record commands, outcomes, full original outputs, and residual risk.

## Mechanism and boundary

The lexer currently reserves `from` globally. Identifier references, bindings, and ordinary object properties consequently reject it. The same classification also treats a following division slash as the start of a regular expression, including inside template interpolation. The fix belongs in token classification and the import separator, not source preprocessing or interpreter dispatch.

IP-002 (`return` method names) shares the object-property identifier gate but not the contextual-binding classification defect. This change does not broaden that gate or change `return` token classification. Re-exports remain unsupported; supported `export const` and `export default` keep their existing grammar.

## Validation

### TDD

- RED: `node_modules/.bin/vitest run packages/safejs/src/parse/contextual-from.test.ts` — exit 1; 35 failed, 10 passed (45 total). The lexer returns `keyword` for `from`, and standalone division raises `Regular expression literals are not supported at line 1, column 6.` Ordinary bindings/keys reject at parse time.
- Initial GREEN: the exact same command — exit 0; 45 passed.
- Initial parser suite: `node_modules/.bin/vitest run packages/safejs/src/parse` — one failure in the old invalid-import assertion, 258 passed, one skipped. The assertion expected a valid `from` alias to fail; its reserved-word replacement retains the rejection coverage.
- Original workflow RED: all eight native fixtures matched the historical complete outputs, every independent field anchor, and exact/required operation-order anchors. All eight SafeJS executions rejected with zero steps and the same full error below. Native ran before SafeJS, and the original source was unchanged.

```json
{"ok":false,"error":{"name":"ParseError","message":"Unexpected token 'from' at line 13, column 14.","kind":"ParseError","span":{"start":{"column":14,"line":13,"offset":352},"end":{"column":15,"line":13,"offset":353}}},"steps":0}
```

The eight original fixture IDs are `02-append`, `02-prepend`, `02-remove`, `02-rotate`, `02-mixed`, `02-replace-all`, `02-unkeyed`, and `02-reverse`.

### Final command results and handoff risks

| Command | Observed result |
| --- | --- |
| `node_modules/.bin/vitest run packages/safejs/src/parse/contextual-from.test.ts` | RED: exit 1, 35 failed / 10 passed. GREEN: exit 0, 45 passed. |
| `node_modules/.bin/vitest run packages/safejs/src/parse` | Final exit 0: 11 files passed / one opt-in fuzz file skipped; 259 tests passed / one skipped. |
| `node_modules/.bin/vitest run packages/safejs/src --exclude packages/safejs/src/sandbox-integrity.test.ts` | First run started before the invalid-alias assertion correction: exit 1, one failure / 4,009 passed / 34 skipped. Second run: exit 1, 11 failures / 4,107 passed / 34 skipped across 137 files. All second-run failures are the independently owned COLL-001 raw interpreter cursor validation cases described below; parser tests pass. |
| `node_modules/.bin/tsc --noEmit -p packages/safejs/tsconfig.json` | Exit 0. |
| `node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/safejs/src/parse/contextual-from.test.ts` | Exit 0; includes the new regression test itself. |
| `npm run lint:types` | Exit 2, 181 diagnostics in root `src/**`, including unresolved workspace declarations such as `@poe-code/poe-agent`, `toolcraft`, `@poe-code/braintrust`, and `@poe-code/pipeline`, plus resulting type errors. No root-build or other-lane changes attempted. |
| `node_modules/.bin/prettier --check packages/safejs/src/parse/contextual-from.test.ts packages/safejs/src/parse/tokenizer.ts packages/safejs/src/parse/parser.ts packages/safejs/src/parse/parser.test.ts` | Exit 0, all four code files match formatting. Initial check flagged only the new test; formatting was corrected with `apply_patch`. |
| `git diff --check -- packages/safejs/src/parse/tokenizer.ts packages/safejs/src/parse/parser.ts packages/safejs/src/parse/parser.test.ts packages/safejs/src/parse/contextual-from.test.ts docs/plans/safejs-fix-tree-01.md` | Exit 0. |

- Broader validation is **not fully green**. In `packages/safejs/src/interp/globals/collections-iteration-validation.test.ts:313`, raw interpreter restoration at the second visit fails for Map/Set growth, delete-next, delete-current, clear-insert, reinsert-current, and Map update-next. For example, restored Map growth omits the appended `d:4` visit/entry. This belongs to the frozen COLL-001 interpreter lane; no changes were made there.
- The security-specific sandbox-integrity test file and adversarial suite were not selected. The fuzz test remains opt-in/skipped. No archived/security audit payload was read or run. These are ordinary functional regressions and bounded algorithm checks, not security probes.
- The current shared worktree includes other workers' interpreter/global/string changes. Results describe that live worktree, not an isolated patch build; independent validation is still required. The only production delta owned here is the two parser/lexer files claimed above. The user's subsequent clarification confirms exclusive parser/lexer ownership and explicitly excludes `interp/**` and `lint/**`.
- Exact changed paths: `packages/safejs/src/parse/tokenizer.ts`, `packages/safejs/src/parse/parser.ts`, `packages/safejs/src/parse/parser.test.ts`, `packages/safejs/src/parse/contextual-from.test.ts`, and `docs/plans/safejs-fix-tree-01.md`.
- IP-002 stays unfixed: `return` remains a keyword and the property-key gate is unchanged. This fix does not claim complete ECMAScript grammar, re-export support, or arbitrary keyword method support.
- Two preliminary Node-REPL child-launch attempts failed with `ENOENT` before any payload executed. All recorded native/SafeJS workflow executions used terminal Node `v22.22.2`; no failed launch is counted as a workflow run.
- No README, master-plan, interpreter, lint, shared-global, original-repository, staging, commit, branch, pull, or push changes. No visual CLI behavior changed, so no screenshot was generated.

### Original workflow command

Run in the fix worktree. The RED execution used this same native-first driver without the final SafeJS-match assertion, so it retained all eight failures. Native ESM imports the unchanged source bytes from a data URL; there is no compatibility rewrite. No capability, guest filesystem/network/timer/LLM operation, archive, or security probe is exposed. Child bounds are 192 MiB heap, 10 seconds hard timeout, 1 MiB output, and the SafeJS limits in the command.

```bash
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
const root = '/Users/kjopek/Workspace/poe-code';
const audit = root + '/out/safejs-audit-2026-08-27';
const metadata = JSON.parse(readFileSync(audit + '/inventory-verification.json', 'utf8'));
const excluded = new Set(metadata.archiveReadPolicy.excludedPaths.map(file => resolve(root, file)));
if (excluded.size !== 38) throw Error('Expected 38 exclusions');
function readAudit(relative) {
  const file = resolve(audit, relative);
  if (!file.startsWith(audit + '/') || excluded.has(file) || file.startsWith(audit + '/security/')) throw Error('Excluded path');
  return readFileSync(file, 'utf8');
}
const source = readAudit('tree-reconciliation/02-virtual-dom-reorder.ajs');
const cases = JSON.parse(readAudit('tree-reconciliation/cases.json')).cases.filter(item => item.algorithm === '02');
const reference = JSON.parse(readAudit('tree-reconciliation/native-reference.json'));
const childProgram = `import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(0, 'utf8'));
let budget;
try {
  let value;
  if (input.mode === 'native') {
    const module = await import('data:text/javascript;base64,' + Buffer.from(input.source).toString('base64'));
    value = await module.default(input.fixture);
  } else {
    const { run } = await import('./packages/safejs/src/run.ts');
    const { Budget } = await import('./packages/safejs/src/interp/budget.ts');
    budget = new Budget({ maxSteps: 200000, maxCallDepth: 96, stringLength: 65536, arrayLength: 2048, dataSize: 1048576, deadline: Date.now() + 4000 });
    const result = await run(input.source, { modules: {}, entryPointArgs: [input.fixture], budget, randomSeed: 827 });
    if (!result.ok) throw result.error;
    value = result.returnValue;
  }
  console.log(JSON.stringify({ ok: true, value, ...(budget ? { steps: budget.stepsUsed } : {}) }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: { name: error.name, message: error.message, kind: error.kind, span: error.span }, ...(budget ? { steps: budget.stepsUsed } : {}) }));
}`;
const native = new Map();
console.log(JSON.stringify({ sourceSha256: createHash('sha256').update(source).digest('hex'), excluded: excluded.size, securityExcluded: true }));
for (const mode of ['native', 'safe']) {
  for (const item of cases) {
    const child = spawnSync(process.execPath, ['--max-old-space-size=192', ...(mode === 'safe' ? ['--import', 'tsx'] : []), '--input-type=module', '-e', childProgram], { cwd: process.cwd(), env: { PATH: process.env.PATH, TSX_DISABLE_CACHE: '1' }, input: JSON.stringify({ mode, source, fixture: item.input }), encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1048576 });
    if (child.status !== 0 || child.signal || child.error || child.stderr) throw Error(JSON.stringify({ status: child.status, signal: child.signal, error: child.error, stderr: child.stderr }));
    const output = JSON.parse(child.stdout);
    if (mode === 'native') {
      const historical = reference.records.find(record => record.id === item.id).output.value;
      const operations = output.value.trace.map(operation => operation.op + ':' + operation.key + (operation.index === undefined ? '' : '@' + operation.index));
      if (!output.ok || !isDeepStrictEqual(output.value, historical) || !Object.entries(item.anchors).every(([key, value]) => isDeepStrictEqual(output.value[key], value)) || (item.operationAnchors.exact ? !isDeepStrictEqual(operations, item.operationAnchors.exact) : !item.operationAnchors.includes.every(operation => operations.includes(operation)))) throw Error('Native anchor mismatch: ' + item.id);
      native.set(item.id, output.value);
    }
    console.log(JSON.stringify({ id: item.id, mode, ...output, matchesNative: isDeepStrictEqual(output.value, native.get(item.id)) }));
    if (mode === 'safe' && (!output.ok || !isDeepStrictEqual(output.value, native.get(item.id)))) throw Error('SafeJS mismatch: ' + item.id);
  }
}
NODE
```

### AST parser compatibility command

The unchanged substantial arithmetic parser/evaluator in `ast-parsers/examples/01-precedence-parser.js` covers all three original precedence, associativity, and unary/group fixtures. This is a compatibility control, not an additional TREE-01 failure claim. Each native result must match its historical full output and authored anchors before any SafeJS execution.

```bash
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
const root = '/Users/kjopek/Workspace/poe-code';
const audit = root + '/out/safejs-audit-2026-08-27';
const metadata = JSON.parse(readFileSync(audit + '/inventory-verification.json', 'utf8'));
const excluded = new Set(metadata.archiveReadPolicy.excludedPaths.map(file => resolve(root, file)));
if (excluded.size !== 38) throw Error('Expected 38 exclusions');
function readAudit(relative) {
  const file = resolve(audit, relative);
  if (!file.startsWith(audit + '/') || excluded.has(file) || file.startsWith(audit + '/security/')) throw Error('Excluded path');
  return readFileSync(file, 'utf8');
}
const cases = JSON.parse(readAudit('ast-parsers/cases.json')).cases.filter(item => item.file === 'examples/01-precedence-parser.js');
const oracle = JSON.parse(readAudit('ast-parsers/expected.json'));
const source = readAudit('ast-parsers/examples/01-precedence-parser.js');
const sourceSha256 = createHash('sha256').update(source).digest('hex');
const childProgram = `import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(0, 'utf8'));
let value;
let budget;
if (input.mode === 'native') {
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  value = await new AsyncFunction('caseIndex', input.source)(input.caseIndex);
} else {
  const { run } = await import('./packages/safejs/src/run.ts');
  const { Budget } = await import('./packages/safejs/src/interp/budget.ts');
  budget = new Budget({ maxSteps: 200000, maxCallDepth: 96, stringLength: 65536, arrayLength: 2048, dataSize: 1048576, deadline: Date.now() + 4000 });
  const result = await run(input.source, { modules: {}, bindings: { caseIndex: input.caseIndex }, budget, randomSeed: 827 });
  if (!result.ok) throw result.error;
  value = result.returnValue;
}
console.log(JSON.stringify({ ok: true, value, ...(budget ? { steps: budget.stepsUsed } : {}) }));`;
const native = new Map();
console.log(JSON.stringify({ sourceSha256, excluded: excluded.size, securityExcluded: true }));
for (const mode of ['native', 'safe']) {
  for (const item of cases) {
    const historical = oracle.cases.find(record => record.id === item.id);
    if (sourceSha256 !== historical.sourceSha256) throw Error('Source hash mismatch');
    const child = spawnSync(process.execPath, ['--max-old-space-size=192', ...(mode === 'safe' ? ['--import', 'tsx'] : []), '--input-type=module', '-e', childProgram], { cwd: process.cwd(), env: { PATH: process.env.PATH, TSX_DISABLE_CACHE: '1' }, input: JSON.stringify({ mode, source, caseIndex: item.caseIndex }), encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1048576 });
    if (child.status !== 0 || child.signal || child.error || child.stderr) throw Error(JSON.stringify({ status: child.status, signal: child.signal, error: child.error, stderr: child.stderr }));
    const output = JSON.parse(child.stdout);
    if (!isDeepStrictEqual(output.value, historical.expected.returnValue) || !Object.entries(item.anchor).every(([key, value]) => isDeepStrictEqual(output.value[key], value))) throw Error('Historical/anchor mismatch: ' + item.id);
    if (mode === 'native') native.set(item.id, output.value);
    const matchesNative = isDeepStrictEqual(output.value, native.get(item.id));
    console.log(JSON.stringify({ id: item.id, mode, ...output, matchesNative }));
    if (!matchesNative) throw Error('Native mismatch: ' + item.id);
  }
}
NODE
```

### AST parser full outputs

All six child processes exited 0 with no stderr or signal; all three SafeJS outputs match fresh native results and historical anchors exactly.

```jsonl
{"sourceSha256":"1bdcdc4192025f40c2d607f20344f87175783fcf197e5ccc64fa6aa9a1ba478d","excluded":38,"securityExcluded":true}
{"id":"precedence-order","mode":"native","ok":true,"value":{"tree":{"type":"BinaryExpression","operator":"-","left":{"type":"BinaryExpression","operator":"+","left":{"type":"Identifier","name":"subtotal"},"right":{"type":"BinaryExpression","operator":"*","left":{"type":"Identifier","name":"tax"},"right":{"type":"Literal","value":2}}},"right":{"type":"Identifier","name":"discount"}},"prefix":"(- (+ subtotal (* tax 2)) discount)","value":41,"nodeCount":7},"matchesNative":true}
{"id":"precedence-right-power","mode":"native","ok":true,"value":{"tree":{"type":"BinaryExpression","operator":"+","left":{"type":"BinaryExpression","operator":"**","left":{"type":"Literal","value":2},"right":{"type":"BinaryExpression","operator":"**","left":{"type":"Literal","value":3},"right":{"type":"Literal","value":2}}},"right":{"type":"BinaryExpression","operator":"/","left":{"type":"BinaryExpression","operator":"-","left":{"type":"Literal","value":12},"right":{"type":"Literal","value":4}},"right":{"type":"Literal","value":2}}},"prefix":"(+ (** 2 (** 3 2)) (/ (- 12 4) 2))","value":516,"nodeCount":11},"matchesNative":true}
{"id":"precedence-unary-groups","mode":"native","ok":true,"value":{"tree":{"type":"BinaryExpression","operator":"+","left":{"type":"BinaryExpression","operator":"*","left":{"type":"BinaryExpression","operator":"+","left":{"type":"Identifier","name":"rate"},"right":{"type":"Literal","value":2}},"right":{"type":"UnaryExpression","operator":"-","argument":{"type":"Identifier","name":"quantity"},"prefix":true}},"right":{"type":"BinaryExpression","operator":"/","left":{"type":"Literal","value":18},"right":{"type":"BinaryExpression","operator":"*","left":{"type":"Literal","value":3},"right":{"type":"Literal","value":2}}}},"prefix":"(+ (* (+ rate 2) (- quantity)) (/ 18 (* 3 2)))","value":-17,"nodeCount":12},"matchesNative":true}
{"id":"precedence-order","mode":"safe","ok":true,"value":{"tree":{"type":"BinaryExpression","operator":"-","left":{"type":"BinaryExpression","operator":"+","left":{"type":"Identifier","name":"subtotal"},"right":{"type":"BinaryExpression","operator":"*","left":{"type":"Identifier","name":"tax"},"right":{"type":"Literal","value":2}}},"right":{"type":"Identifier","name":"discount"}},"prefix":"(- (+ subtotal (* tax 2)) discount)","value":41,"nodeCount":7},"steps":1878,"matchesNative":true}
{"id":"precedence-right-power","mode":"safe","ok":true,"value":{"tree":{"type":"BinaryExpression","operator":"+","left":{"type":"BinaryExpression","operator":"**","left":{"type":"Literal","value":2},"right":{"type":"BinaryExpression","operator":"**","left":{"type":"Literal","value":3},"right":{"type":"Literal","value":2}}},"right":{"type":"BinaryExpression","operator":"/","left":{"type":"BinaryExpression","operator":"-","left":{"type":"Literal","value":12},"right":{"type":"Literal","value":4}},"right":{"type":"Literal","value":2}}},"prefix":"(+ (** 2 (** 3 2)) (/ (- 12 4) 2))","value":516,"nodeCount":11},"steps":2382,"matchesNative":true}
{"id":"precedence-unary-groups","mode":"safe","ok":true,"value":{"tree":{"type":"BinaryExpression","operator":"+","left":{"type":"BinaryExpression","operator":"*","left":{"type":"BinaryExpression","operator":"+","left":{"type":"Identifier","name":"rate"},"right":{"type":"Literal","value":2}},"right":{"type":"UnaryExpression","operator":"-","argument":{"type":"Identifier","name":"quantity"},"prefix":true}},"right":{"type":"BinaryExpression","operator":"/","left":{"type":"Literal","value":18},"right":{"type":"BinaryExpression","operator":"*","left":{"type":"Literal","value":3},"right":{"type":"Literal","value":2}}}},"prefix":"(+ (* (+ rate 2) (- quantity)) (/ 18 (* 3 2)))","value":-17,"nodeCount":12},"steps":2867,"matchesNative":true}
```

### Original full outputs

All child processes exited 0 with no stderr or signal. All eight fresh native executions passed historical full-output and independent-anchor checks before SafeJS began. All eight SafeJS complete return values match native exactly.

```jsonl
{"sourceSha256":"1d26b46870e4fd1c1cc961c127c5dcc0dc62930e7bbf93b78cd216a0bbe76bcf","excluded":38,"securityExcluded":true}
{"id":"02-append","mode":"native","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"li","key":"a","text":"","props":{},"children":[]},{"tag":"li","key":"b","text":"","props":{},"children":[]},{"tag":"li","key":"c","text":"","props":{},"children":[]}]},"alignment":["a","b","c"],"moves":null,"trace":[{"op":"insert","key":"c","index":2,"id":3}],"reusedKeys":["a","b"],"childOrigins":[0,1,-1]},"matchesNative":true}
{"id":"02-prepend","mode":"native","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"li","key":"c","text":"","props":{},"children":[]},{"tag":"li","key":"a","text":"","props":{},"children":[]},{"tag":"li","key":"b","text":"","props":{},"children":[]}]},"alignment":["a","b","c"],"moves":{"removes":[{"from":2,"key":"c"}],"inserts":[{"key":"c","to":0}]},"trace":[{"op":"insert","key":"c","index":2,"id":3},{"op":"detach","key":"c","index":2,"id":3},{"op":"move","key":"c","index":0,"id":3}],"reusedKeys":["a","b"],"childOrigins":[-1,0,1]},"matchesNative":true}
{"id":"02-remove","mode":"native","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"li","key":"a","text":"","props":{},"children":[]},{"tag":"li","key":"c","text":"","props":{},"children":[]}]},"alignment":["a",null,"c"],"moves":null,"trace":[{"op":"remove","key":"b","index":1,"id":2}],"reusedKeys":["a","c"],"childOrigins":[0,2]},"matchesNative":true}
{"id":"02-rotate","mode":"native","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"li","key":"d","text":"","props":{},"children":[]},{"tag":"li","key":"a","text":"","props":{},"children":[]},{"tag":"li","key":"b","text":"","props":{},"children":[]},{"tag":"li","key":"c","text":"","props":{},"children":[]}]},"alignment":["a","b","c","d"],"moves":{"removes":[{"from":3,"key":"d"}],"inserts":[{"key":"d","to":0}]},"trace":[{"op":"detach","key":"d","index":3,"id":4},{"op":"move","key":"d","index":0,"id":4}],"reusedKeys":["a","b","c","d"],"childOrigins":[3,0,1,2]},"matchesNative":true}
{"id":"02-mixed","mode":"native","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"p","key":null,"text":"U2","props":{},"children":[]},{"tag":"li","key":"b","text":"","props":{},"children":[]},{"tag":"li","key":"c","text":"","props":{},"children":[]},{"tag":"p","key":null,"text":"V2","props":{},"children":[]},{"tag":"li","key":"a","text":"","props":{},"children":[]}]},"alignment":["a","p","b","p","c"],"moves":{"removes":[{"from":0,"key":"a"},{"from":3,"key":"c"}],"inserts":[{"key":"c","to":2},{"key":"a","to":4}]},"trace":[{"op":"insert","key":"c","index":4,"id":5},{"op":"detach","key":"a","index":0,"id":1},{"op":"detach","key":"c","index":3,"id":5},{"op":"move","key":"c","index":2,"id":5},{"op":"move","key":"a","index":4,"id":1},{"op":"text","key":"p","value":"U2","id":2},{"op":"text","key":"p","value":"V2","id":4}],"reusedKeys":["a","b"],"childOrigins":[1,2,-1,3,0]},"matchesNative":true}
{"id":"02-replace-all","mode":"native","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"li","key":"c","text":"","props":{},"children":[]},{"tag":"li","key":"d","text":"","props":{},"children":[]}]},"alignment":[null,null,"c","d"],"moves":null,"trace":[{"op":"insert","key":"c","index":2,"id":3},{"op":"insert","key":"d","index":3,"id":4},{"op":"remove","key":"a","index":0,"id":1},{"op":"remove","key":"b","index":0,"id":2}],"reusedKeys":[],"childOrigins":[-1,-1]},"matchesNative":true}
{"id":"02-unkeyed","mode":"native","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"p","key":null,"text":"C","props":{},"children":[]},{"tag":"p","key":null,"text":"D","props":{},"children":[]},{"tag":"p","key":null,"text":"E","props":{},"children":[]}]},"alignment":["p","p","p"],"moves":null,"trace":[{"op":"insert","key":"p","index":2,"id":3},{"op":"text","key":"p","value":"C","id":1},{"op":"text","key":"p","value":"D","id":2}],"reusedKeys":[],"childOrigins":[0,1,-1]},"matchesNative":true}
{"id":"02-reverse","mode":"native","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"li","key":"d","text":"","props":{},"children":[]},{"tag":"li","key":"c","text":"","props":{},"children":[]},{"tag":"li","key":"b","text":"","props":{},"children":[]},{"tag":"li","key":"a","text":"","props":{},"children":[]}]},"alignment":["a","b","c","d"],"moves":{"removes":[{"from":0,"key":"a"},{"from":1,"key":"c"},{"from":1,"key":"d"}],"inserts":[{"key":"d","to":0},{"key":"c","to":1},{"key":"a","to":3}]},"trace":[{"op":"detach","key":"a","index":0,"id":1},{"op":"detach","key":"c","index":1,"id":3},{"op":"detach","key":"d","index":1,"id":4},{"op":"move","key":"d","index":0,"id":4},{"op":"move","key":"c","index":1,"id":3},{"op":"move","key":"a","index":3,"id":1}],"reusedKeys":["a","b","c","d"],"childOrigins":[3,2,1,0]},"matchesNative":true}
{"id":"02-append","mode":"safe","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"li","key":"a","text":"","props":{},"children":[]},{"tag":"li","key":"b","text":"","props":{},"children":[]},{"tag":"li","key":"c","text":"","props":{},"children":[]}]},"alignment":["a","b","c"],"moves":null,"trace":[{"op":"insert","key":"c","index":2,"id":3}],"reusedKeys":["a","b"],"childOrigins":[0,1,-1]},"steps":666,"matchesNative":true}
{"id":"02-prepend","mode":"safe","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"li","key":"c","text":"","props":{},"children":[]},{"tag":"li","key":"a","text":"","props":{},"children":[]},{"tag":"li","key":"b","text":"","props":{},"children":[]}]},"alignment":["a","b","c"],"moves":{"removes":[{"from":2,"key":"c"}],"inserts":[{"key":"c","to":0}]},"trace":[{"op":"insert","key":"c","index":2,"id":3},{"op":"detach","key":"c","index":2,"id":3},{"op":"move","key":"c","index":0,"id":3}],"reusedKeys":["a","b"],"childOrigins":[-1,0,1]},"steps":807,"matchesNative":true}
{"id":"02-remove","mode":"safe","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"li","key":"a","text":"","props":{},"children":[]},{"tag":"li","key":"c","text":"","props":{},"children":[]}]},"alignment":["a",null,"c"],"moves":null,"trace":[{"op":"remove","key":"b","index":1,"id":2}],"reusedKeys":["a","c"],"childOrigins":[0,2]},"steps":659,"matchesNative":true}
{"id":"02-rotate","mode":"safe","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"li","key":"d","text":"","props":{},"children":[]},{"tag":"li","key":"a","text":"","props":{},"children":[]},{"tag":"li","key":"b","text":"","props":{},"children":[]},{"tag":"li","key":"c","text":"","props":{},"children":[]}]},"alignment":["a","b","c","d"],"moves":{"removes":[{"from":3,"key":"d"}],"inserts":[{"key":"d","to":0}]},"trace":[{"op":"detach","key":"d","index":3,"id":4},{"op":"move","key":"d","index":0,"id":4}],"reusedKeys":["a","b","c","d"],"childOrigins":[3,0,1,2]},"steps":1005,"matchesNative":true}
{"id":"02-mixed","mode":"safe","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"p","key":null,"text":"U2","props":{},"children":[]},{"tag":"li","key":"b","text":"","props":{},"children":[]},{"tag":"li","key":"c","text":"","props":{},"children":[]},{"tag":"p","key":null,"text":"V2","props":{},"children":[]},{"tag":"li","key":"a","text":"","props":{},"children":[]}]},"alignment":["a","p","b","p","c"],"moves":{"removes":[{"from":0,"key":"a"},{"from":3,"key":"c"}],"inserts":[{"key":"c","to":2},{"key":"a","to":4}]},"trace":[{"op":"insert","key":"c","index":4,"id":5},{"op":"detach","key":"a","index":0,"id":1},{"op":"detach","key":"c","index":3,"id":5},{"op":"move","key":"c","index":2,"id":5},{"op":"move","key":"a","index":4,"id":1},{"op":"text","key":"p","value":"U2","id":2},{"op":"text","key":"p","value":"V2","id":4}],"reusedKeys":["a","b"],"childOrigins":[1,2,-1,3,0]},"steps":1279,"matchesNative":true}
{"id":"02-replace-all","mode":"safe","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"li","key":"c","text":"","props":{},"children":[]},{"tag":"li","key":"d","text":"","props":{},"children":[]}]},"alignment":[null,null,"c","d"],"moves":null,"trace":[{"op":"insert","key":"c","index":2,"id":3},{"op":"insert","key":"d","index":3,"id":4},{"op":"remove","key":"a","index":0,"id":1},{"op":"remove","key":"b","index":0,"id":2}],"reusedKeys":[],"childOrigins":[-1,-1]},"steps":726,"matchesNative":true}
{"id":"02-unkeyed","mode":"safe","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"p","key":null,"text":"C","props":{},"children":[]},{"tag":"p","key":null,"text":"D","props":{},"children":[]},{"tag":"p","key":null,"text":"E","props":{},"children":[]}]},"alignment":["p","p","p"],"moves":null,"trace":[{"op":"insert","key":"p","index":2,"id":3},{"op":"text","key":"p","value":"C","id":1},{"op":"text","key":"p","value":"D","id":2}],"reusedKeys":[],"childOrigins":[0,1,-1]},"steps":384,"matchesNative":true}
{"id":"02-reverse","mode":"safe","ok":true,"value":{"tree":{"tag":"ul","key":"root","text":"","props":{},"children":[{"tag":"li","key":"d","text":"","props":{},"children":[]},{"tag":"li","key":"c","text":"","props":{},"children":[]},{"tag":"li","key":"b","text":"","props":{},"children":[]},{"tag":"li","key":"a","text":"","props":{},"children":[]}]},"alignment":["a","b","c","d"],"moves":{"removes":[{"from":0,"key":"a"},{"from":1,"key":"c"},{"from":1,"key":"d"}],"inserts":[{"key":"d","to":0},{"key":"c","to":1},{"key":"a","to":3}]},"trace":[{"op":"detach","key":"a","index":0,"id":1},{"op":"detach","key":"c","index":1,"id":3},{"op":"detach","key":"d","index":1,"id":4},{"op":"move","key":"d","index":0,"id":4},{"op":"move","key":"c","index":1,"id":3},{"op":"move","key":"a","index":3,"id":1}],"reusedKeys":["a","b","c","d"],"childOrigins":[3,2,1,0]},"steps":1269,"matchesNative":true}
```


## TREE-01-VALIDATION-01 follow-up: escaped contextual separators

### Ownership, attribution, and root fix

The user released the parser/lexer freeze solely to repair Laplace's five inherited import-separator failures. Follow-up writes are exclusively `packages/safejs/src/parse/parser.ts` and this author plan. The tokenizer, both author test files, validator test, validator report, validator evidence/history, interpreter, lint, other lanes, README, and Git state are not edited by this follow-up.

Laplace established that these five grammar failures also exist at the original baseline; they are inherited, not a regression introduced by the original TREE-01 patch. They nevertheless remain mandatory failing tests to fix, not waived known failures. Before editing production, the author reran the unchanged validator and obtained exactly 54 passes / 5 failures. All five failures were the existing escaped-separator assertions at `contextual-from-validation.test.ts:163`; none were weakened, skipped, or marked expected failures.

The import parser now checks the token's original source-span width as well as decoded identifier type/value. Because the required separator is the ASCII spelling `from`, its literal source width equals its decoded width; every Unicode escape increases source width. Existing start/end offsets therefore distinguish literal contextual syntax from escaped ordinary identifiers without adding token fields, passing source through the parser, applying regexes, or rewriting source. The comparison uses `fromToken.value.length`, not a duplicated numeric constant. This restriction applies only at the import separator. Ordinary escaped bindings, local import aliases, and object keys remain accepted. IP-002's reserved `return` method behavior is unchanged.

Fresh native `node --input-type=module --check` probes on stdin reject all five invalid separators with exit 1 and `SyntaxError: 'from' must not contain escaped characters`. Before the patch SafeJS accepted all five; after it SafeJS rejects all five with `Expected 'from'` diagnostics at columns 14, 14, 14, 18, and 19. All five escaped separator tokens have source width 9 and decoded width 4. Three additional ordinary escaped-binding/alias/key controls pass native syntax checks (exit 0) and SafeJS parsing. These checks resolve no imports and expose no guest I/O.

### Actual follow-up commands and results

| Command | Result |
| --- | --- |
| `node_modules/.bin/vitest run packages/safejs/src/parse/contextual-from-validation.test.ts` | Reexecuted RED before patch: exit 1, 54 passed / 5 failed. Same command after patch: exit 0, all 59 passed. Validator bytes unchanged. |
| `node_modules/.bin/vitest run packages/safejs/src/parse` | Exit 0: 318 passed / one opt-in fuzz skip; 12 passing files / one skipped file. |
| `node_modules/.bin/vitest run packages/safejs/src/run.test.ts packages/safejs/src/lint.syntax-parity.test.ts packages/safejs/src/lint/rules/AS-unused-import.test.ts packages/safejs/src/lint/rules/AS-export-import-meta.test.ts packages/safejs/src/lint/rules/module-registry.test.ts` | Exit 0: 114 passed across five files. |
| `node_modules/.bin/tsc --noEmit -p packages/safejs/tsconfig.json` | Exit 0. |
| `node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/safejs/src/parse/contextual-from-validation.test.ts packages/safejs/src/parse/contextual-from.test.ts` | Exit 0. |
| `node_modules/.bin/eslint packages/safejs/src/parse/contextual-from-validation.test.ts packages/safejs/src/parse/contextual-from.test.ts packages/safejs/src/parse/tokenizer.ts packages/safejs/src/parse/parser.ts packages/safejs/src/parse/parser.test.ts` | Exit 0; no diagnostics. |
| `node_modules/.bin/prettier --check packages/safejs/src/parse/parser.ts` | Exit 0. |
| `git diff --check -- packages/safejs/src/parse/parser.ts docs/plans/safejs-fix-tree-01.md` | Exit 0. |
| Existing complete `Original workflow command` and `AST parser compatibility command` fenced commands in this plan, executed again through `/bin/zsh -c` | Both exit 0; 8/8 tree and 3/3 AST complete outputs again match historical outputs and fresh native anchors before SafeJS comparisons. |

The fresh original-workflow checks use the exact unchanged audit sources and the same safeguards already documented above: exact 38 archive exclusions established before payload reads, entire security directory excluded, 10-second child timeout, 192 MiB heap, and bounded SafeJS budgets with empty modules. Tree source SHA-256 remains `1d26b46870e4fd1c1cc961c127c5dcc0dc62930e7bbf93b78cd216a0bbe76bcf`; arithmetic-parser source remains `1bdcdc4192025f40c2d607f20344f87175783fcf197e5ccc64fa6aa9a1ba478d`. Full output structures are identical to the earlier complete outputs retained above; step counts also remain 666, 807, 659, 1005, 1279, 726, 384, 1269 for tree fixtures and 1878, 2382, 2867 for AST fixtures.

### RED/GREEN and preservation SHA-256

| Path | Before patch / RED | After patch / GREEN |
| --- | --- | --- |
| `packages/safejs/src/parse/parser.ts` | `9b7e68ace8c7c9dbe13e694548367646c2c1e7a0f550744c88da55ea92b1ae35` | `8e6c8b4e5d2d5484dcf5149f5a55da7d6427e0ed62444fe079ec64ee1f1ff114` |
| `packages/safejs/src/parse/tokenizer.ts` | `380af40a787118c2abdcb28eab78d7f04d733bde5db50f5e597d05a4ff81483e` | unchanged |
| `packages/safejs/src/parse/parser.test.ts` | `c001c3f40c3ac2786eab2e3e25ebf53429de6a9174db69ceac144171192fbaa1` | unchanged |
| `packages/safejs/src/parse/contextual-from.test.ts` | `1c18d28def1adc7ce775c339b11d360b067e923460913c3eca1f94a26d039149` | unchanged |
| `packages/safejs/src/parse/contextual-from-validation.test.ts` | `3fae78429c12f7232318e60f40aa580290f4bc14b090f3b939e12f9836be899e` | unchanged |
| `docs/plans/safejs-validate-tree-01.md` | `9ce00f96512bf09dd83d125373bc160102251368e91df69c35a921a3790f5325` | unchanged |
| `docs/plans/safejs-fix-tree-01.md` | `79cabd3432801824c4e763a6388d6b6463cd0ef92ae3d804933422368f4c6c35` | append-only follow-up; original contents preserved byte-for-byte as prefix |

Validator evidence files are not modified. Their preserved hashes are:

- `out/safejs-remediation/tree-01-validation/findings.json`: `2d823f42a511ef7d83fb3fe561baf9bfe87103d601286d6c8c062fb3d2df5fac`.
- `out/safejs-remediation/tree-01-validation/original-workflows.json`: `17d53487587f22c93924cd6f67b50233737ae4e1005a33355a1155ab514843aa`.
- `out/safejs-remediation/tree-01-validation/commands.json`: `0ac13776498dc9d9dd8d5bf0baad675039eebc02f1f2fc3cf92e1c2f7dc48f7e`.
- `out/safejs-remediation/tree-01-validation/provenance.json`: `3353a738230a1605eba26fe1e0386d77666c08d86b26eb65d680c497ff194b5d`.

### Revalidation readiness and remaining gates

Ready for Laplace's fresh independent revalidation; author GREEN is not independent sign-off or publication approval. The validator's withheld report and all historical evidence remain unchanged. TREE-01 remains held until Laplace reports fresh GREEN. No publication, commit, staging, branch, pull, or push was attempted.

The full SafeJS suite and root workspace typecheck were not rerun in this follow-up; earlier other-lane failures/root-declaration errors above remain historical observations, not fresh checks or waived publisher gates. No complete-grammar claim is made, and no other contextual keyword or IP-002 method grammar is changed.
