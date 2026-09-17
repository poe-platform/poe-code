import { acquire, connect, sessions } from '@cloudflare/playwright';
import { createPlaywrightCli, createPlaywrightAdapter } from '@safe-bash-fixture/playwright';
import { Shell } from '@safe-bash-fixture/shell';
import { MemoryFileSystem } from '@safe-bash-fixture/memory';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export default {
  async fetch(request, env) {
    const options = await request.json();
    const started = Date.now();
    const report = { name: options.name, timingOrigin: started, actionTimeoutMs: 3000, commands: [], events: [], routes: [], nativeContextCloses: [] };
    let connectedBrowser;
    let ownedSessionId;
    let disposed = false;
    const event = (name, extra = {}) => {
      const entry = { name, elapsedMs: Date.now() - started, ...extra };
      report.events.push(entry);
      console.log('CLI_EVENT', JSON.stringify({ case: options.name, ...entry }));
    };
    const release = async () => {
      event('release-start');
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(new Error('Owned session release deadline exceeded')), 5000);
      report.releaseDeadlineMs = 5000;
      report.releaseRequests = [];
      const releaseBinding = {
        fetch(input, init) {
          deadline.signal.throwIfAborted();
          report.releaseRequests.push({ method: init?.method ?? 'GET', signalAttached: true });
          return env.BROWSER.fetch(input, { ...init, signal: deadline.signal });
        },
      };
      try {
        report.connectedBeforeDelete = connectedBrowser?.isConnected();
        report.sessionPresentBeforeDelete = (await sessions(releaseBinding)).some(session => session.sessionId === ownedSessionId);
        const response = await releaseBinding.fetch(`http://fake.host/v1/devtools/browser/${encodeURIComponent(ownedSessionId)}`, { method: 'DELETE' });
        report.deletion = { status: response.status, body: (await response.text()).slice(0, 300), elapsedMs: Date.now() - started };
        event('delete-response', report.deletion);
        if (!response.ok) throw new Error('Owned session DELETE failed');
        for (let attempt = 0; attempt < 50; attempt++) {
          if (!(await sessions(releaseBinding)).some(session => session.sessionId === ownedSessionId)) {
            report.absence = { observed: true, polls: attempt + 1, elapsedMs: Date.now() - started };
            event('session-absent', report.absence);
            return;
          }
          await sleep(100);
        }
        throw new Error('Owned session remains listed');
      } finally {
        clearTimeout(timer);
      }
    };
    const adapter = createPlaywrightAdapter({ chromium: {
      async acquireBrowser() {
        ({ sessionId: ownedSessionId } = await acquire(env.BROWSER));
        report.sessionId = ownedSessionId;
        event('acquired', { sessionId: ownedSessionId });
        try { connectedBrowser = await connect(env.BROWSER, ownedSessionId); }
        catch (error) { await release(); throw error; }
        report.browserVersion = connectedBrowser.version();
        connectedBrowser.on('disconnected', () => event('browser-disconnected'));
        const newContext = connectedBrowser.newContext.bind(connectedBrowser);
        connectedBrowser.newContext = async (...args) => {
          const context = await newContext(...args);
          context.on('close', () => event('context-close-event'));
          const close = context.close.bind(context);
          context.close = async (...closeArgs) => {
            const original = { status: 'pending', startedMs: Date.now() - started };
            report.nativeContextCloses.push(original);
            event('native-context-close-start');
            try {
              const result = await close(...closeArgs);
              original.status = 'fulfilled';
              original.settledMs = Date.now() - started;
              event('native-context-close-fulfilled');
              return result;
            } catch (error) {
              original.status = 'rejected';
              original.settledMs = Date.now() - started;
              original.errorMessage = String(error.message).slice(0, 500);
              event('native-context-close-rejected', { message: original.errorMessage });
              throw error;
            }
          };
          const newPage = context.newPage.bind(context);
          context.newPage = async (...pageArgs) => {
            const page = await newPage(...pageArgs);
            await page.route('**/*', async route => {
              const nativeRequest = route.request();
              const record = { method: nativeRequest.method(), url: nativeRequest.url(), elapsedMs: Date.now() - started, continued: false };
              report.routes.push(record);
              event('route-callback', record);
              await route.continue();
              record.continued = true;
            });
            event('route-installed');
            return page;
          };
          return context;
        };
        return {
          browser: connectedBrowser,
          async interrupt() {
            event('interrupt-start');
            await connectedBrowser.close();
            event('interrupt-fulfilled', { connected: connectedBrowser.isConnected() });
          },
          release,
        };
      },
    } });
    const cli = createPlaywrightCli({ adapter, limits: { actionTimeoutMs: 3000 } });
    const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxWallClockMs: 20000, maxCpuMs: 20000 } }).use(cli.plugin);
    try {
      for (const command of [`playwright-cli open ${options.url}`, 'playwright-cli snapshot', 'playwright-cli click e1']) {
        const commandStarted = Date.now() - started;
        const result = await shell.exec(command);
        const record = { command, startedMs: commandStarted, settledMs: Date.now() - started, exitCode: result.exitCode, stdout: result.stdout.slice(0, 2000), stderr: result.stderr.slice(0, 2000) };
        report.commands.push(record);
        event('command-settled', record);
        if (result.exitCode !== 0) break;
      }
      if (report.commands.at(-1)?.exitCode === 0) {
        const page = connectedBrowser.contexts()[0].pages()[0];
        const completed = await page.waitForFunction(() => globalThis.document.title === 'Upload complete', undefined, { timeout: 5000 });
        await completed.dispose();
        report.uploadCompleted = true;
        event('upload-completed');
      }
      report.beforeShellDispose = { connected: connectedBrowser?.isConnected(), elapsedMs: Date.now() - started };
      const disposalStarted = Date.now() - started;
      await shell.dispose();
      disposed = true;
      report.shellDispose = { status: 'fulfilled', startedMs: disposalStarted, settledMs: Date.now() - started };
      event('shell-dispose-fulfilled', report.shellDispose);
      report.connectedAfterDispose = connectedBrowser?.isConnected();
      report.allNativeContextClosesSettled = report.nativeContextCloses.every(operation => operation.status !== 'pending');
      report.completedMs = Date.now() - started;
      return Response.json(report);
    } finally {
      if (!disposed) await shell.dispose();
    }
  },
};
