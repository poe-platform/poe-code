import { afterEach, expect, it, vi } from 'vitest';
import { Volume } from 'memfs';
import { DocumentBudget } from './budget.js';
import { readDocumentArchive } from './admission.js';
import { writeDocumentArchive } from './document-write.js';
import { publishDocumentArchive } from './publication.js';
import * as validation from './validation.js';
import { equationContext, equationFixture } from '../tests/fixtures/equations.js';

afterEach(() => vi.restoreAllMocks());

it.each([false, true])('inherits XML admission at publication including original-byte no-op %s', async original => {
  const input = await equationFixture(), archive = await readDocumentArchive(input, equationContext);
  const budget = new DocumentBudget({ xmlNodes: 10_000_000 });
  const context = { ...equationContext, budget, encoding: { order: 'input' as const, compression: 'store' as const } };
  const validate = vi.spyOn(validation, 'validateDocumentArchive');
  if (original) await publishDocumentArchive(archive, { dryRun: true }, context, undefined, input);
  else {
    const volume = Volume.fromJSON({ '/output': '' });
    await writeDocumentArchive(archive, { async write(bytes) { volume.appendFileSync('/output', bytes); } }, context.encoding, context);
    expect(volume.statSync('/output').size).toBeGreaterThan(0);
  }
  expect(validate).toHaveBeenCalledTimes(1);
  expect(validate.mock.calls[0]![1]).toMatchObject({ maxNodes: 10_000_000 });
  expect(validate.mock.calls[0]![2]).toBeInstanceOf(DocumentBudget);
});

it('retains a caller-lowered XML ceiling before publishing bytes', async () => {
  const archive = await readDocumentArchive(await equationFixture(), equationContext);
  let writes = 0;
  const budget = new DocumentBudget().lower({ xmlNodes: 1 });
  await expect(writeDocumentArchive(archive, { async write() { writes++; } }, { order: 'input', compression: 'store' }, { ...equationContext, budget }))
    .rejects.toMatchObject({ code: 'limit-exceeded' });
  expect(writes).toBe(0);
});
