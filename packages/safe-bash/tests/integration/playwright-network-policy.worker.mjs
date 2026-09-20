import { acquire, connect } from '@cloudflare/playwright';
import { installPlaywrightNetworkPolicy } from '../../src/playwright/network-policy.ts';

export default {
  async fetch(request, env) {
    const options = await request.json();
    const { sessionId } = await acquire(env.BROWSER, options.baseline ? {} : { guardrails: { allowedDomains: [] } });
    let browser;
    let policy;
    let socket;
    const routes = [];
    const failures = [];
    const release = async () => {
      await browser?.close();
      const response = await env.BROWSER.fetch(`http://fake.host/v1/devtools/browser/${sessionId}`, { method: 'DELETE' });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Browser deletion failed: ${response.status}`);
    };
    try {
      if (!options.baseline) {
        const response = await env.BROWSER.fetch(`http://fake.host/v1/devtools/browser/${sessionId}`, { headers: { Upgrade: 'websocket' } });
        if (!response.webSocket) throw new Error(`CDP socket HTTP ${response.status}`);
        socket = response.webSocket;
        socket.accept();
        policy = await installPlaywrightNetworkPolicy({
          socket, directNetwork: 'http-blocked-by-host', retire: release,
          onRequestFailure: failure => failures.push(failure),
          async fetch(request) {
            routes.push(request.url);
            if (!request.url.startsWith('https://allowed.example/')) throw new Error('Forbidden destination');
            const url = new URL(request.url);
            if (url.pathname === '/start') return { status: options.status, headers: [{ name: 'location', value: options.forbidden }], body: new Uint8Array() };
            if (url.pathname === '/normal') return { status: options.status, headers: [{ name: 'location', value: '/final' }, { name: 'set-cookie', value: 'hop=present; Secure; Path=/' }], body: new Uint8Array() };
            return { status: 200, headers: [{ name: 'content-type', value: 'text/html' }], body: new TextEncoder().encode('<title>Native final</title>') };
          },
        });
      }
      browser = await connect(env.BROWSER, sessionId);
      const context = await browser.newContext();
      if (options.baseline) await context.route('**/*', async route => {
        routes.push(route.request().url());
        if (route.request().url().startsWith('https://allowed.example/')) {
          await route.fulfill({ status: options.status, headers: { location: options.forbidden } });
        } else await route.abort();
      });
      const page = await context.newPage();
      let error;
      try { await page.goto('https://allowed.example/start', { timeout: 5000 }); }
      catch (cause) { error = String(cause); }
      const forbiddenUrl = page.url();
      await page.close();
      let normal;
      if (!options.baseline) {
        const normalPage = await context.newPage();
        await normalPage.goto('https://allowed.example/normal', { timeout: 5000 });
        normal = { url: normalPage.url(), title: await normalPage.title(), cookies: await context.cookies() };
      }
      return Response.json({ routes, url: forbiddenUrl, error, failures, normal });
    } finally {
      if (policy) await policy.dispose();
      else { socket?.close(); await release(); }
    }
  },
};
