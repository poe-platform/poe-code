import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = '2272feb92f8c0f151385f59f79eee004c50d14b8';
const execution = realpathSync(mkdtempSync(join(tmpdir(), 'html-markdown-negative-')));
const output = realpathSync(mkdtempSync(join(tmpdir(), 'html-markdown-negative-evidence-')));
const rows = [];
const cases = [
  { name: 'scheme', file: 'entities.ts', before: 'if (prefix.includes(":")) {', after: 'if (false) {',
    assertion: `const result=await convert('<a href="javascript:alert(1)">label</a>');assert.equal(result.stdout,'label\\n');` },
  { name: 'input', file: 'budget.ts', before: 'this.check(amount, maximum - this[kind], kind);', after: 'if(kind!=="input") this.check(amount, maximum - this[kind], kind);',
    assertion: `const result=await convert('abcd',{limits:{maxInputBytes:3}});assert.equal(result.exitCode,1);assert.match(result.stderr,/input limit exceeded/);` },
  { name: 'registration', file: 'input.ts', before: 'context.registerCleanup?.(this.close);', after: '',
    assertion: `let acquired=0;const result=await convert({[Symbol.asyncIterator](){acquired++;throw new Error('acquired')}},{},{registerCleanup(){throw new Error('scope closed')}});assert.equal(result.exitCode,1);assert.equal(acquired,0);` },
];
try {
  const archive = execFileSync('git', ['--no-replace-objects', 'archive', source, 'src', 'tests/commands/html-to-markdown/helpers.ts'], { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
  execFileSync('/usr/bin/tar', ['-xf', '-', '-C', execution], { input: archive });
  writeFileSync(join(execution, 'package.json'), JSON.stringify({ type: 'module' }));
  const runner = join(execution, 'tests/commands/html-to-markdown/guard.ts');
  for (const entry of cases) {
    const path = join(execution, 'src/commands/html-to-markdown', entry.file);
    const original = readFileSync(path, 'utf8'); assert.equal(original.split(entry.before).length, 2);
    writeFileSync(runner, `import assert from 'node:assert/strict';import{convert}from'./helpers.js';${entry.assertion}`);
    for (const variant of ['baseline', 'mutant']) {
      writeFileSync(path, variant === 'baseline' ? original : original.replace(entry.before, entry.after));
      const result = spawnSync(process.execPath, [join(repository, 'node_modules/tsx/dist/cli.mjs'), runner], { cwd: execution, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
      const prefix = entry.name + '-' + variant;
      writeFileSync(join(output, prefix + '.stdout'), result.stdout ?? ''); writeFileSync(join(output, prefix + '.stderr'), result.stderr ?? '');
      assert.equal(result.status, variant === 'baseline' ? 0 : 1, prefix + '\n' + result.stderr);
      if (variant === 'mutant') assert.match(result.stderr, /AssertionError/u);
      rows.push({ name: entry.name, variant, status: result.status, sourceSha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
    }
    writeFileSync(path, original);
  }
  console.log(JSON.stringify({ output, baseline: 3, mutantsDetected: 3 }));
} finally {
  rmSync(execution, { recursive: true, force: true });
  writeFileSync(join(output, 'REPORT.json'), JSON.stringify({ source, rows, executionRemoved: true, qualification: 'Three explicit author assertion controls in copied source; no mutation of production and no broad mutation-coverage claim' }, null, 2) + '\n');
}
