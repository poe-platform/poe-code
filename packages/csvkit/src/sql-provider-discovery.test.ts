import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { databases } from './databases.js';

test('one declarative compiler descriptor supplies both advertised and accepted dialect choices', async () => {
  const profile = { ...databases.find(dialect => dialect.default)!, name: 'zprofile', default: false };
  const providers = [...databases, profile];
  vi.resetModules();
  vi.doMock('./databases.js', () => ({ databases: providers }));
  try {
    const { commands } = await import('./commands.js');
    const csvsql = commands.find(command => command.name === 'csvsql')!;
    const names = providers.filter(dialect => !dialect.default).map(dialect => dialect.name);
    assert.ok(csvsql.usage.includes('{' + names.join(',') + '}'));
    assert.deepEqual(csvsql.actions.find(action => action.dest === 'dialect')!.choices, names);
  } finally { vi.doUnmock('./databases.js'); vi.resetModules(); }
});
