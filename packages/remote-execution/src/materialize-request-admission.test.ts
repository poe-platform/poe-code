import { expect, it, vi } from 'vitest';
import { createExecutionClient } from './materializations.js';
import type { DependencyMaterializeRequest } from './protocol.js';

it.each([
  { sessionId: 'another-session' },
  { epoch: 'retired' },
  { manifestId: '' },
  { manifestRevision: '' },
  { bindingId: '' },
  { operationKey: '' },
  { operationKey: 'x'.repeat(257) },
  { expectedDirectoryRevision: undefined },
  { expectedDirectoryRevision: '' },
  { expectedDirectoryRevision: 42 },
  { destination: '/canonical/missing-output' },
])('rejects invalid materialization admission %j before credentials or transport', async change => {
  const token = vi.fn(() => 'token');
  const transport = vi.fn(async () => Response.json({}));
  const client = createExecutionClient({ baseUrl: 'https://admission.test', sessionId: 's', epoch: 'e', token, fetch: transport });
  const input = { sessionId: 's', epoch: 'e', manifestId: 'uploaded-manifest', manifestRevision: 'r',
    bindingId: 'host-binding', expectedDirectoryRevision: null, operationKey: 'prepare', ...change };
  const before = structuredClone(input);
  await expect(client.materialize(input as DependencyMaterializeRequest)).rejects.toBeInstanceOf(TypeError);
  expect(token).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
  expect(input).toEqual(before);
});
