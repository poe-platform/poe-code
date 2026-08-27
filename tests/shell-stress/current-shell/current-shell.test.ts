import assert from 'node:assert/strict';
import test from 'node:test';

test('independent frozen current-shell cohort', { timeout: 400_000 }, async (context) => {
  const { runProduct } = await import(new URL('./run-product.mjs', import.meta.url).href);
  const report = await runProduct();
  for (const row of report.rows) {
    await context.test(`${row.cohort}: ${row.id}`, () => {
      assert.equal(row.valid, true, JSON.stringify({ process: row.process, sourceGuard: row.sourceGuard }));
      assert.equal(row.passed, true, JSON.stringify({ expected: row.expected, actual: row.child?.observation }));
    });
  }
});
