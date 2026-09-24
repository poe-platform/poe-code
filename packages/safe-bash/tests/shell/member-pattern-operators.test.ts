import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers.js';

// Each expected value is a transformed member, before @/* field joining.
const cases = [
  ['#pre_', ['a_pre_a.txt', 'b_pre_b.txt']],
  ['##*pre_', ['a.txt', 'b.txt']],
  ['%.txt', ['pre_a_pre_a', 'pre_b_pre_b']],
  ['%%_*', ['pre', 'pre']],
  ['/pre_/X', ['Xa_pre_a.txt', 'Xb_pre_b.txt']],
  ['//pre_/X', ['Xa_Xa.txt', 'Xb_Xb.txt']],
  ['/#pre_/X', ['Xa_pre_a.txt', 'Xb_pre_b.txt']],
  ['/%txt/md', ['pre_a_pre_a.md', 'pre_b_pre_b.md']],
] as const;

for (const [operator, members] of cases) {
  for (const selector of ['@', '*', 'a[@]', 'a[*]']) {
    for (const ifs of [' ', ':', '']) {
      test(`member pattern ${selector}${operator} with IFS=${JSON.stringify(ifs)}`, async () => {
        const { shell } = setup();
        try {
          const result = await shell.exec(`set -- pre_a_pre_a.txt pre_b_pre_b.txt; a=("$@"); IFS='${ifs}'; args "\${${selector}${operator}}"`);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, '');
          assert.deepEqual(JSON.parse(result.stdout), selector.includes('@') ? members : [members.join(ifs)]);
        } finally { await shell.dispose(); }
      });
    }
    test(`empty member pattern ${selector}${operator}`, async () => {
      const { shell } = setup();
      try {
        const result = await shell.exec(`set --; a=(); args "\${${selector}${operator}}"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, '');
        assert.deepEqual(JSON.parse(result.stdout), selector.includes('@') ? [] : ['']);
      } finally { await shell.dispose(); }
    });
  }
}
