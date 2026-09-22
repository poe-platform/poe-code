import {EventEmitter} from 'node:events';
import {Writable} from 'node:stream';
import {afterEach, expect, it, vi} from 'vitest';

const transport = vi.hoisted(() => ({create: vi.fn()}));
vi.mock('node:https', () => ({createServer: transport.create}));
import {startMediaService} from './service.js';

function fixture() {
  const listener = Object.assign(new EventEmitter(), {
    listen: vi.fn(function(this: EventEmitter) { queueMicrotask(() => this.emit('listening')); }),
    close: vi.fn((done: (error?: Error) => void) => done()),
    closeAllConnections: vi.fn(),
    maxConnections: 0, requestTimeout: 0, headersTimeout: 0, keepAliveTimeout: 0,
  });
  transport.create.mockReturnValue(listener);
  const service = {fetch: vi.fn(async () => new Response(null)), sweep: vi.fn(async () => {}), close: vi.fn(async () => {})};
  const options = {
    createService: vi.fn(async () => service),
    http: {origin: 'https://media.test', maxConnections: 8, tls: {key: 'fixture', cert: 'fixture'}},
    listen: {host: '127.0.0.1', port: 8443}, sweepIntervalMs: 1000,
    shutdownGraceMs: 100, requestTimeoutMs: 10000, headersTimeoutMs: 1000, keepAliveTimeoutMs: 500,
    reportError: vi.fn(),
  };
  return {listener, service, options};
}

afterEach(() => {vi.useRealTimers(); vi.clearAllMocks();});

it.each([
  {listen: {host: '', port: 8443}}, {listen: {host: '127.0.0.1', port: 0}},
  {listen: {host: '127.0.0.1', port: 65536}}, {sweepIntervalMs: 0},
  {shutdownGraceMs: Infinity}, {requestTimeoutMs: 0}, {headersTimeoutMs: 0},
  {keepAliveTimeoutMs: 0}, {http: {origin: 'http://media.test', maxConnections: 8, tls: {}}},
])('refuses invalid operator configuration before service acquisition: %j', async invalid => {
  const f = fixture();
  await expect(startMediaService({...f.options, ...invalid})).rejects.toThrow();
  expect(f.options.createService).not.toHaveBeenCalled(); expect(transport.create).not.toHaveBeenCalled();
});

it('awaits listening and sets finite transport bounds without running native work', async () => {
  const f = fixture(); let ready!: () => void;
  f.listener.listen.mockImplementation(() => {ready = () => f.listener.emit('listening');});
  let exposed = false;
  const pending = startMediaService(f.options).then(value => {exposed = true; return value;});
  await Promise.resolve(); expect(exposed).toBe(false); ready();
  const service = await pending;
  try {
    expect(f.listener.listen).toHaveBeenCalledWith({host: '127.0.0.1', port: 8443});
    expect(f.listener).toMatchObject({maxConnections: 8, requestTimeout: 10000, headersTimeout: 1000, keepAliveTimeout: 500});
    expect(f.service.fetch).not.toHaveBeenCalled(); expect(f.service.sweep).not.toHaveBeenCalled();
  } finally {await service.close();}
  expect(f.service.close).toHaveBeenCalledOnce(); expect(f.listener.close).toHaveBeenCalledOnce();
});

it('keeps the selected service methods and receiver across operator mutation', async () => {
  vi.useFakeTimers(); const f = fixture(); const replacement = vi.fn();
  f.service.sweep.mockImplementation(async function(this: unknown) {expect(this).toBe(f.service);});
  const close = f.service.close;
  const running = await startMediaService(f.options);
  f.service.sweep = replacement; f.service.close = replacement;
  f.options.sweepIntervalMs = 1; f.options.listen.port = 22;
  await vi.advanceTimersByTimeAsync(1000); await running.close();
  expect(replacement).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});

it('serializes lease sweeps and drains the admitted sweep before service retirement', async () => {
  vi.useFakeTimers(); const f = fixture(); let finish!: () => void;
  const sweep = new Promise<void>(resolve => {finish = resolve;});
  f.service.sweep.mockImplementation(() => sweep);
  const running = await startMediaService(f.options);
  await vi.advanceTimersByTimeAsync(5000); expect(f.service.sweep).toHaveBeenCalledOnce();
  const close = running.close(); expect(running.close()).toBe(close);
  await Promise.resolve(); expect(f.service.close).not.toHaveBeenCalled();
  finish(); await close; await vi.advanceTimersByTimeAsync(5000);
  expect(f.service.sweep).toHaveBeenCalledOnce(); expect(f.service.close).toHaveBeenCalledOnce();
});

it('refuses new requests on existing transports as soon as shutdown starts', async () => {
  vi.useFakeTimers(); const f = fixture(); let finish!: () => void;
  f.service.sweep.mockImplementation(() => new Promise<void>(resolve => {finish = resolve;}));
  const running = await startMediaService(f.options); await vi.advanceTimersByTimeAsync(1000);
  const close = running.close();
  // Exercise the actual Fetch handler used by the HTTPS adapter while sweep
  // drainage keeps the underlying generic service alive.
  const handler = transport.create.mock.calls.at(-1)![1];
  const input = Object.assign(new EventEmitter(), {url: '/v1/sessions', method: 'GET', headers: {}});
  const output = Object.assign(new Writable({write(_chunk, _encoding, done) {done();}}), {writeHead: vi.fn(), headersSent: false});
  await handler(input, output);
  expect(output.writeHead).toHaveBeenCalledWith(503, expect.anything());
  expect(f.service.fetch).not.toHaveBeenCalled(); finish(); await close;
});

it('reports sweep failure and continues bounded lease maintenance', async () => {
  vi.useFakeTimers(); const f = fixture(); const failure = new Error('lease cleanup failed');
  f.service.sweep.mockRejectedValueOnce(failure);
  const running = await startMediaService(f.options);
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.options.reportError).toHaveBeenCalledWith(failure); expect(f.service.sweep).toHaveBeenCalledTimes(2);
  await running.close();
});

it('stops listening immediately and retires active transports after the explicit grace', async () => {
  vi.useFakeTimers(); const f = fixture(); let drained!: () => void;
  f.listener.close.mockImplementation(done => {drained = () => done();});
  f.listener.closeAllConnections.mockImplementation(() => {drained();});
  const running = await startMediaService(f.options); const close = running.close();
  expect(f.listener.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(99); expect(f.listener.closeAllConnections).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await close;
  expect(f.listener.closeAllConnections).toHaveBeenCalledOnce(); expect(f.service.close).toHaveBeenCalledOnce();
});

it('retires a service acquired before listener startup failure', async () => {
  const f = fixture(); const failure = new Error('address unavailable');
  f.listener.listen.mockImplementation(function(this: EventEmitter) {queueMicrotask(() => this.emit('error', failure));});
  await expect(startMediaService(f.options)).rejects.toBe(failure);
  expect(f.service.close).toHaveBeenCalledOnce(); expect(f.listener.close).toHaveBeenCalledOnce();
});

it('preserves listener startup and service cleanup errors without abandoning either close', async () => {
  const f = fixture(); const startup = new Error('TLS configuration invalid'); const cleanup = new Error('namespace release failed');
  transport.create.mockImplementationOnce(() => {throw startup;}); f.service.close.mockRejectedValueOnce(cleanup);
  await expect(startMediaService(f.options)).rejects.toMatchObject({errors: [startup, cleanup]});
  expect(f.service.close).toHaveBeenCalledOnce();
});

it('attempts service cleanup when transport retirement fails and keeps both failures', async () => {
  const f = fixture(); const transportFailure = new Error('listener close failed'); const cleanup = new Error('namespace close failed');
  f.listener.close.mockImplementation(done => {done(transportFailure);}); f.service.close.mockRejectedValueOnce(cleanup);
  const running = await startMediaService(f.options);
  await expect(running.close()).rejects.toMatchObject({errors: [transportFailure, cleanup]});
  expect(f.service.close).toHaveBeenCalledOnce();
});
