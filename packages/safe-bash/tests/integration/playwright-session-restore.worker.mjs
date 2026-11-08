import { acquire, connect, endpointURLString, sessions } from '@cloudflare/playwright';
import { createPlaywrightCli } from '@poe-platform/safe-bash/commands/playwright';
import { Shell } from '@poe-platform/safe-bash';
import { MemoryFileSystem } from '@poe-platform/safe-fs/core';

export default {
  async fetch(_request, env) {
    const { sessionId } = await acquire(env.BROWSER, { keep_alive: 600000 });
    const endpoint = new URL(endpointURLString(env.BROWSER, { sessionId }));
    endpoint.searchParams.set('persistent', 'true');
    let browser;
    let original;
    let restored;
    const outputs = [];
    const lease = (connection, context) => ({
      context,
      onClosed(listener) {
        connection.on('disconnected', listener);
        return () => connection.off('disconnected', listener);
      },
      release: () => connection.close(),
    });
    const cleanup = async () => {
      await Promise.allSettled([original?.dispose(), restored?.dispose(), browser?.close()]);
      const response = await env.BROWSER.fetch('http://browser/v1/devtools/browser/' + encodeURIComponent(sessionId), { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new Error('Owned test browser deletion failed');
      if ((await sessions(env.BROWSER)).some(session => session.sessionId === sessionId)) throw new Error('Owned test browser remains live');
    };
    try {
      browser = await connect(endpoint);
      const context = browser.contexts()[0];
      if (!context) throw new Error('Persistent connection did not expose its default context');
      await context.addCookies([{ name: 'owned', value: 'retained', url: 'https://example.test' }]);
      const adapter = { browsers: { chromium: { headed: false } }, async acquire() { return lease(browser, context); } };
      original = createPlaywrightCli({ adapter });
      const first = new Shell({ fs: new MemoryFileSystem() }).use(original.plugin);
      for (const command of ['playwright-cli -s=owned open', 'playwright-cli -s=owned tab-new']) {
        const result = await first.exec(command);
        if (result.exitCode) throw new Error(result.stderr);
      }
      const checkpoint = original.inspectSessions()[0];
      const contextIndex = browser.contexts().indexOf(checkpoint.context);
      const selectedIndex = context.pages().indexOf(checkpoint.selectedPage);
      const tabCount = context.pages().length;
      await checkpoint.selectedPage.setContent('<h1>Restored selected tab</h1><button>Save</button>');
      const before = await first.exec('playwright-cli -s=owned snapshot');
      if (before.exitCode) throw new Error(before.stderr);
      await browser.close();
      browser = await connect(endpoint);
      const reconnected = browser.contexts()[contextIndex];
      if (!reconnected) throw new Error('Provider did not retain the context after reconnect');
      restored = createPlaywrightCli({ adapter });
      await restored.restoreSession({ name: 'owned', expiresAt: Date.now() + 60000,
        async acquire() { return { lease: lease(browser, reconnected), selectedPage: reconnected.pages()[selectedIndex] }; },
      });
      const second = new Shell({ fs: new MemoryFileSystem() }).use(restored.plugin);
      for (const command of ['playwright-cli -s=owned snapshot', 'playwright-cli -s=owned tab-list', 'playwright-cli list']) {
        outputs.push(await second.exec(command));
      }
      const stale = await second.exec('playwright-cli -s=owned click e1');
      const cookies = await reconnected.cookies('https://example.test');
      const report = { outputs, stale, tabCount, restoredTabCount: reconnected.pages().length,
        selectedIndex: reconnected.pages().indexOf(restored.inspectSessions()[0].selectedPage),
        selectedText: await restored.inspectSessions()[0].selectedPage.textContent('h1'),
        cookieRetained: cookies.some(cookie => cookie.name === 'owned' && cookie.value === 'retained'),
      };
      report.close = await second.exec('playwright-cli close-all');
      report.remaining = restored.inspectSessions().length;
      await second.dispose();
      await first.dispose();
      return Response.json(report);
    } finally {
      await cleanup();
    }
  },
};
