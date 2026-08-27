import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { digest } from '../jq-42-independent-review/common.mjs';
import { artifact } from './artifacts.mjs';

const tapPath = 'tests/commands/structured-stress/jq-42-author-20260827/final-owned.tap';
const bytes = readFileSync(tapPath);
const failures = [...bytes.toString().matchAll(/^not ok \d+ - (.*)$/gmu)].map(match => match[1]);
assert.equal(failures.length, 22);
const selector = `^(?:${failures.map(name => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})$`;
artifact(`${process.argv[2]}-selector.json`, { tapPath, tapSha256: digest(bytes), failures, selector,
  limits: 'Only these 22 existing failing test names are selected; no full broad-suite denominator is claimed.' });
const result = spawnSync(process.execPath, ['tests/commands/structured-stress/jq-42-independent-final/command.mjs',
  `${process.argv[2]}-legacy-red`, process.execPath, '--import', 'tsx', '--test', `--test-name-pattern=${selector}`,
  'tests/commands/structured/cli.test.ts', 'tests/commands/structured/resources.test.ts',
  'tests/commands/structured-stress/safety.test.ts', 'tests/commands/structured-stress/raw-input.test.ts',
  'tests/commands/structured-stress/independent-increment/safety.test.ts'], { encoding: 'utf8', timeout: 130000 });
console.log(result.stdout);
assert.ifError(result.error);
process.exitCode = result.status;
