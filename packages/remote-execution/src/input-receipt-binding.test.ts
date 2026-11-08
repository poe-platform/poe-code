import { expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import type { Ack } from './wire.generated.js';

const session = { sessionId: 'session', epoch: 'epoch' };
const limits = { maxFrameBytes: 64, maxControlBytes: 64, channels: [1] };
const frames = [{ kind: 'data' as const, channelId: 1, sequence: 3n, offset: 2n,
  correlationId: 0n, payload: Uint8Array.of(0, 255) }];
const accepted: Ack = { type: 'Ack', laneId: 'input', sequence: '3', offsets: [{ channelId: 1, offset: '4' }] };

it.each([
  { laneId: 'other' }, { sequence: '2' }, { offsets: [] },
  { offsets: [{ channelId: 1, offset: '3' }] },
  { offsets: [{ channelId: 1, offset: '5' }] },
  { offsets: [{ channelId: 1, offset: '4' }, { channelId: 1, offset: '4' }] },
])('refuses an input receipt that does not establish submitted delivery: %j', async mismatch => {
  const fetch = vi.fn(async () => Response.json({ ...accepted, ...mismatch }, { headers: { 'Execution-Epoch': session.epoch } }));
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch });
  await expect(client.sendFrames(session, 'job', 'input', frames, limits, 'batch')).rejects.toMatchObject({
    category: 'transport', phase: 'unknown', status: 502,
    recovery: { ...session, jobId: 'job', laneId: 'input', operationKey: 'batch' },
  });
  expect(fetch).toHaveBeenCalledOnce();
});

it('allows a replay receipt covering later accepted input without requiring it to regress', async () => {
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch: async () =>
    Response.json({ ...accepted, sequence: '4', offsets: [{ channelId: 1, offset: '7' }] }, { headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client.sendFrames(session, 'job', 'input', frames, limits, 'batch')).resolves.toMatchObject({ sequence: '4' });
});

it.each(['{', JSON.stringify({ ...accepted, sequence: 'invalid' })])('classifies malformed input acceptance as transport uncertainty: %s', async body => {
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch: async () =>
    new Response(body, { headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client.sendFrames(session, 'job', 'input', frames, limits, 'batch')).rejects.toMatchObject({
    category: 'transport', phase: 'unknown', status: 502,
    recovery: { ...session, jobId: 'job', laneId: 'input', operationKey: 'batch' },
  });
});

it('never advances a completed input channel even if another channel has later receipts', async () => {
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token', fetch: async () =>
    Response.json({ ...accepted, sequence: '4', offsets: [{ channelId: 1, offset: '7' }] }, { headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client.sendFrames(session, 'job', 'input', [{ ...frames[0], kind: 'end', payload: new Uint8Array() }], limits, 'end')).rejects.toMatchObject({
    category: 'transport', phase: 'unknown', status: 502,
  });
});

it.each(['missing', 'oversized'] as const)('preserves recovery identity for a %s input receipt', async failure => {
  const client = createClient({ baseUrl: 'https://media.test', token: async () => 'token', maxResponseBytes: 8, fetch: async () =>
    new Response(failure === 'missing' ? null : JSON.stringify(accepted), { headers: { 'Execution-Epoch': session.epoch } }) });
  await expect(client.sendFrames(session, 'job', 'input', frames, limits, 'batch')).rejects.toMatchObject({
    category: 'transport', phase: 'unknown', status: 502,
    recovery: { ...session, jobId: 'job', laneId: 'input', operationKey: 'batch' },
  });
});
