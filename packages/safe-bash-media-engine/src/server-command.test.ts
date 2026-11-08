import {EventEmitter} from 'node:events';
import {expect, it, vi} from 'vitest';

const startup = vi.hoisted(() => ({start: vi.fn(), deployment: vi.fn()}));
vi.mock('@poe-code/remote-execution/server', () => ({startMediaService: startup.start}));
vi.mock('./server.js', () => ({createMediaDeployment: startup.deployment}));
import {runMediaServer} from './server-command.js';

function fixture() {
  const signals = new EventEmitter(); const close = vi.fn(async () => {});
  const configuration = {deployment: {build: {digest: 'fixture'}}, service: {listen: {host: '127.0.0.1', port: 8443}}};
  const load = vi.fn(async () => ({configuration})); const reportError = vi.fn();
  startup.start.mockReset().mockResolvedValue({close}); startup.deployment.mockReset().mockResolvedValue('verified-service');
  return {signals, close, configuration, load, reportError};
}

it.each([[], ['relative.mjs'], ['/operator/config.mjs', 'extra'], ['/bad\0config.mjs']])('requires exactly one explicit absolute operator module before acquisition: %j', async args => {
  const f = fixture();
  await expect(runMediaServer(args, f)).rejects.toThrow('absolute');
  expect(f.load).not.toHaveBeenCalled(); expect(startup.start).not.toHaveBeenCalled();
  expect(f.signals.listenerCount('SIGTERM')).toBe(0);
});

it('starts only the explicitly loaded deployment and separates operator reporting from native streams', async () => {
  const f = fixture(); const running = await runMediaServer(['/operator/config.mjs'], f);
  expect(f.load).toHaveBeenCalledWith('/operator/config.mjs');
  const options = startup.start.mock.calls[0][0];
  expect(options.listen).toEqual(f.configuration.service.listen);
  expect(await options.createService()).toBe('verified-service');
  expect(startup.deployment).toHaveBeenCalledWith(f.configuration.deployment);
  options.reportError(new Error('native cleanup unavailable'));
  expect(f.reportError).toHaveBeenCalledOnce();
  await running.close(); expect(f.close).toHaveBeenCalledOnce();
  expect(f.signals.listenerCount('SIGINT')).toBe(0); expect(f.signals.listenerCount('SIGTERM')).toBe(0);
});

it.each(['SIGINT', 'SIGTERM'])('drains service ownership on %s exactly once', async signal => {
  const f = fixture(); const running = await runMediaServer(['/operator/config.mjs'], f);
  f.signals.emit(signal); await running.close();
  expect(f.close).toHaveBeenCalledOnce(); expect(f.signals.listenerCount(signal)).toBe(0);
});

it('retains shutdown requested while configured service startup is still pending', async () => {
  const f = fixture(); let ready!: (service: {close: typeof f.close}) => void;
  startup.start.mockImplementation(() => new Promise(resolve => {ready = resolve;}));
  const pending = runMediaServer(['/operator/config.mjs'], f);
  await Promise.resolve(); f.signals.emit('SIGTERM'); ready({close: f.close});
  const running = await pending; await running.close(); expect(f.close).toHaveBeenCalledOnce();
});

it('does not acquire a deployment after shutdown requested during module loading', async () => {
  const f = fixture(); let ready!: (module: {configuration: typeof f.configuration}) => void;
  f.load.mockImplementation(() => new Promise(resolve => {ready = resolve;}));
  const pending = runMediaServer(['/operator/config.mjs'], f);
  f.signals.emit('SIGINT'); ready({configuration: f.configuration});
  await expect(pending).rejects.toThrow('startup canceled');
  expect(startup.start).not.toHaveBeenCalled(); expect(f.signals.listenerCount('SIGTERM')).toBe(0);
});

it('removes operator signal ownership after startup failure', async () => {
  const f = fixture(); const failure = new Error('bad configuration'); f.load.mockRejectedValueOnce(failure);
  await expect(runMediaServer(['/operator/config.mjs'], f)).rejects.toBe(failure);
  expect(f.signals.listenerCount('SIGTERM')).toBe(0); expect(f.signals.listenerCount('SIGINT')).toBe(0);
});

it('retains shutdown failure for the owner and reports it once for a signal', async () => {
  const f = fixture(); const failure = new Error('unknown cleanup'); f.close.mockRejectedValueOnce(failure);
  const running = await runMediaServer(['/operator/config.mjs'], f); f.signals.emit('SIGTERM');
  await expect(running.close()).rejects.toBe(failure);
  expect(f.reportError).toHaveBeenCalledWith(failure); expect(f.close).toHaveBeenCalledOnce();
});
