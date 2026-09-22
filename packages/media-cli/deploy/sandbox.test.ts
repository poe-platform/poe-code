import { beforeEach, expect, it, vi } from 'vitest';
const { getSandbox } = vi.hoisted(() => ({ getSandbox: vi.fn((..._arguments: unknown[]) => ({
  containerFetch: vi.fn(async () => new Response()), destroy: vi.fn(async () => {}),
})) }));
vi.mock('@cloudflare/sandbox', () => ({ getSandbox }));
import { createSandboxDriver } from './sandbox.js';
import provider from '@poe-code/remote-execution/providers/cloudflare';

beforeEach(() => getSandbox.mockClear());

it('selects the pinned stable control options and private server port', async () => {
  const namespace = {} as never;
  const driver = createSandboxDriver(namespace);
  const endpoint = await driver.acquire('tenant');
  expect(getSandbox).toHaveBeenCalledWith(namespace, expect.any(String), {
    ...provider.lifecycle, transport: 'rpc', normalizeId: false,
  });
  const container = getSandbox.mock.results[0]!.value;
  const request = new Request('https://media.internal/v1/jobs');
  await endpoint.fetch(request);
  expect(container.containerFetch).toHaveBeenCalledWith(expect.any(Request), provider.port);
  await driver.destroy('tenant');
  expect(container.destroy).toHaveBeenCalledOnce();
  await expect(endpoint.fetch(request)).rejects.toThrow('retired');
});

it('passes binary duplex lanes and range identity through the SDK adapter without process helpers', async () => {
  const endpoint = await createSandboxDriver({} as never).acquire('binary-tenant');
  const container = getSandbox.mock.results[0]!.value;
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  let input!: ReadableStreamDefaultController<Uint8Array>;
  let incoming!: ReadableStreamDefaultReader<Uint8Array>;
  container.containerFetch.mockImplementationOnce(async (request: Request) => {
    incoming = request.body!.getReader();
    expect(request.headers.get('Authorization')).toBe('Bearer fixture');
    expect(request.headers.get('Range')).toBe('bytes=128-255');
    expect(request.headers.get('If-Match')).toBe('"canonical-revision"');
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    }), { status: 206, headers: {
      'Content-Range': 'bytes 128-255/256', ETag: '"canonical-revision"',
    } });
  });
  const response = await endpoint.fetch(new Request('https://media.internal/v1/jobs/job/streams', {
    method: 'POST', headers: {
      Authorization: 'Bearer fixture', Range: 'bytes=128-255', 'If-Match': '"canonical-revision"',
    }, body: new ReadableStream<Uint8Array>({ start(controller) { input = controller; } }),
    duplex: 'half',
  } as RequestInit));
  const output = response.body!.getReader();
  // Output is available while input remains open. This is a mock adapter
  // receipt, not proof of deployed Sandbox raw media fidelity.
  expect((await output.read()).value).toEqual(bytes);
  input.enqueue(bytes);
  expect((await incoming.read()).value).toEqual(bytes);
  input.close();
  expect((await incoming.read()).done).toBe(true);
  expect((await output.read()).done).toBe(true);
  expect(response.status).toBe(206);
  expect(response.headers.get('Content-Range')).toBe('bytes 128-255/256');
  expect(response.headers.get('ETag')).toBe('"canonical-revision"');
  expect(container.containerFetch).toHaveBeenCalledOnce();
});

it('derives stable SDK-safe container identities from arbitrary authenticated callers', async () => {
  const namespace = {} as never;
  const driver = createSandboxDriver(namespace);
  const owners = ['root', 'caller@example.com/' + 'x'.repeat(100), 'Alice', 'alice'];
  for (const owner of owners) await driver.acquire(owner);
  const ids = getSandbox.mock.calls.map(call => String(call[1]));
  expect(new Set(ids).size).toBe(owners.length);
  for (const id of ids) {
    expect(id.length).toBe(58);
    expect([...id].every(char => 'abcdefghijklmnopqrstuvwxyz234567-'.includes(char))).toBe(true);
  }
  getSandbox.mockClear();
  await createSandboxDriver(namespace).acquire(owners[1]!);
  expect(getSandbox.mock.calls[0]![1]).toBe(ids[1]);
});
