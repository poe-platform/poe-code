import assert from "node:assert/strict";
import {
	acquire,
	type BrowserWorker,
	connect,
	type Page,
} from "@cloudflare/playwright";
import { browserPageCDP } from "../src/browser-page-cdp";
import { createBrowserRunCode } from "../src/browser-run-code";
import { browserRunCodeGuestSource } from "../src/browser-run-code-guest.generated.js";
import { captureRunCodeState } from "../src/browser-run-code-native";
import type { RunCodeState } from "../src/browser-run-code-state";
import { assertRunCodeContextMutations } from "./browser-run-code-context.test.worker-cases";
import { assertRunCodeInitScriptRetention } from "./browser-run-code-init-scripts.test.worker-cases";
import { assertRunCodeNetwork } from "./browser-run-code-network.test.worker-cases";
import { assertRunCodeSerialization } from "./browser-run-code-serialization.test.worker-cases";
import { assertRunCodeTimeouts } from "./browser-run-code-timeouts.test.worker-cases";
import { handleBrowserStorageScenario } from "./browser-storage-route.test.worker-cases";

interface Env {
	BROWSER: BrowserWorker;
	BROWSER_RUN_CODE_LOADER: WorkerLoader;
}
async function fixture(env: Env, mobile: boolean) {
	const { sessionId } = await acquire(env.BROWSER, {});
	const browser = await connect(env.BROWSER, sessionId);
	let retirement: Promise<void> | undefined;
	let retiredState: RunCodeState | undefined;
	const retire = () => {
		retirement ??= (async () => {
			retiredState = captureRunCodeState(browser, context);
			const response = await env.BROWSER.fetch(
				`http://fake.host/v1/devtools/browser/${sessionId}`,
				{ method: "DELETE" },
			);
			await response.body?.cancel();
			if (!response.ok)
				throw new Error(`Retirement failed: ${response.status}`);
		})();
		return retirement;
	};

	const context = await browser.newContext({
		viewport: { width: 640, height: 480 },
		locale: "en-GB",
		colorScheme: "dark",
		isMobile: mobile,
		deviceScaleFactor: mobile ? 2 : 1,
		hasTouch: mobile,
	});
	const page = await context.newPage();
	await page.setContent(
		"<button onclick=\"document.body.dataset.clicked='yes'\">Owner</button>",
	);
	await context.addCookies([
		{ name: "owner", value: "private", domain: "example.com", path: "/" },
	]);
	const execute = createBrowserRunCode({
		ownerId: sessionId,
		browser,
		loader: env.BROWSER_RUN_CODE_LOADER,
		guestSource: browserRunCodeGuestSource,
		retire,
		async connectSocket(signal) {
			const response = await env.BROWSER.fetch(
				`http://fake.host/v1/devtools/browser/${sessionId}`,
				{ headers: { Upgrade: "websocket" }, signal },
			);
			if (!response.webSocket) throw new Error("CDP connection failed");
			return response.webSocket;
		},
	});
	const run = (
		source: string,
		options: {
			page?: Page;
			signal?: AbortSignal;
			maxPages?: number;
			timeoutMs?: number;
			maxOutputBytes?: number;
		} = {},
	) =>
		execute({
			page: options.page ?? page,
			source,
			signal: options.signal ?? new AbortController().signal,
			timeoutMs: options.timeoutMs ?? 10000,
			maxOutputBytes: options.maxOutputBytes ?? 65536,
			maxPages: options.maxPages ?? 4,
		});
	return {
		sessionId,
		browser,
		page,
		context,
		run,
		retired: () => retirement !== undefined,
		retiredState: () => retiredState,
		cleanup: async () => {
			await retire();
			await browser.close();
		},
	};
}
export default {
	async fetch(request: Request, env: Env) {
		const storage = await handleBrowserStorageScenario(request, env);
		if (storage) return storage;
		const f = await fixture(
			env,
			new URL(request.url).pathname.startsWith("/mobile"),
		);
		try {
			switch (new URL(request.url).pathname) {
				case "/serialization":
					await assertRunCodeSerialization(f);
					break;
				case "/context-reuse": {
					await f.run(`async page => {
						const browser = page.context().browser();
						for (let i = 0; i < 20; i++) {
							const context = await browser.newContext();
							await context.close();
						}
					}`);
					assert.equal(f.retired(), false);
					assert.equal(await f.run("async page => page.title()"), "");
					break;
				}
				case "/init-scripts":
				case "/init-script-context-retention":
				case "/init-script-page-retention":
				case "/init-script-byte-retention":
				case "/init-script-page-close-capacity":
				case "/init-script-context-close-capacity":
					await assertRunCodeInitScriptRetention(
						f,
						new URL(request.url).pathname,
					);
					break;
				case "/network":
					await assertRunCodeNetwork(
						f,
						new URL(request.url).searchParams.get("target")!,
					);
					break;
				case "/context-mutations":
					await assertRunCodeContextMutations(f);
					break;
				case "/timeouts":
					await assertRunCodeTimeouts(f);
					break;
				case "/context": {
					const result = (await f.run(`async page => {
      await page.getByRole('button', {name:'Owner'}).click();
      const cookies=await page.context().cookies('https://example.com');
      const extra=await page.context().newPage();
      const cdp=await extra.context().newCDPSession(extra);
      const {targetInfo}=await cdp.send('Target.getTargetInfo');
      const viewport=extra.viewportSize();await extra.close();
      return {cookies,viewport,contextId:targetInfo.browserContextId};
     }`)) as {
						cookies: Array<{ name: string; value: string }>;
						viewport: unknown;
						contextId: string;
					};
					assert.equal(result.cookies[0]?.name, "owner");
					assert.equal(result.cookies[0]?.value, "private");
					assert.deepEqual(result.viewport, { width: 640, height: 480 });
					const cdp = await browserPageCDP(f.page);
					assert.equal(
						result.contextId,
						(await cdp.send("Target.getTargetInfo")).targetInfo
							.browserContextId,
					);
					assert.equal(
						await f.page.evaluate(() => document.body.dataset["clicked"]),
						"yes",
					);
					assert.equal(f.retired(), false);
					await f.run("async page => { await page.context().clearCookies(); }");
					assert.deepEqual(await f.context.cookies(), []);
					break;
				}
				case "/network-close": {
					await f.run(
						"async page => { await page.context().addInitScript('window.closedContext = true'); await page.context().close(); }",
					);
					const cdp = await f.browser.newBrowserCDPSession();
					assert.deepEqual(
						(await cdp.send("Target.getBrowserContexts")).browserContextIds,
						[],
					);
					await cdp.detach();
					break;
				}
				case "/quota": {
					await assert.rejects(
						f.run(
							`async page => {
      const cdp=await page.context().browser().newBrowserCDPSession();
      await cdp.send('Target.createTarget',{url:'about:blank'});
     }`,
							{ maxPages: 1 },
						),
					);
					assert.equal(f.retired(), true);
					break;
				}
				case "/deadline": {
					await assert.rejects(
						f.run("async page => { await new Promise(() => {}); }", {
							timeoutMs: 1000,
						}),
					);
					assert.equal(f.retired(), true);
					const sessionsResponse = await env.BROWSER.fetch(
						"http://fake.host/v1/sessions",
					);
					const sessions = (await sessionsResponse.json()) as {
						sessions: Array<{ sessionId: string }>;
					};
					assert.equal(
						sessions.sessions.some(
							(session) => session.sessionId === f.sessionId,
						),
						false,
					);
					break;
				}
				case "/user-error": {
					await assert.rejects(
						f.run("async page => { throw new Error('user failure'); }", {
							maxOutputBytes: 16 * 1024 * 1024,
						}),
						/user failure/,
					);
					assert.equal(f.retired(), false);
					assert.equal(await f.run("async page => page.title()"), "");
					break;
				}
				case "/mobile": {
					const emulation = () => ({
						width: screen.width,
						height: screen.height,
						dpr: devicePixelRatio,
						language: navigator.language,
						dark: matchMedia("(prefers-color-scheme: dark)").matches,
					});
					const initial = await f.page.evaluate(emulation);
					assert.equal(
						await f.page.evaluate(() => navigator.maxTouchPoints),
						1,
					);
					const touches = await f.run(`async page => {
      const before=await page.evaluate(() => navigator.maxTouchPoints);
      await page.getByRole('button').click();
      const extra=await page.context().newPage();
      const added=await extra.evaluate(() => navigator.maxTouchPoints);
      await extra.close();
      return {before,added};
     }`);
					assert.deepEqual(touches, { before: 1, added: 1 });
					assert.deepEqual(await f.page.evaluate(emulation), initial);
					assert.deepEqual(
						await f.run(`async page => page.evaluate(${emulation.toString()})`),
						initial,
					);
					assert.equal(
						await f.page.evaluate(() => navigator.maxTouchPoints),
						1,
					);
					assert.equal(
						await f.run(
							"async page => page.evaluate(() => navigator.maxTouchPoints)",
						),
						1,
					);
					assert.equal(
						await f.page.evaluate(() => navigator.maxTouchPoints),
						1,
					);
					break;
				}
				case "/mobile-repeat": {
					const environment = () => ({
						width: screen.width,
						height: screen.height,
						dpr: devicePixelRatio,
						touch: navigator.maxTouchPoints,
					});
					const expected = await f.page.evaluate(environment);
					await f.run("async page => page.title()");
					for (let i = 0; i < 2; i++) {
						// biome-ignore lint/performance/noAwaitInLoops: Reproduce stale CDP metrics only after the previous guest has disconnected.
						const inside = await f.run(`async page => {
              await page.getByRole('button', {name:'Owner'}).click();
              return page.evaluate(${environment.toString()});
            }`);
						assert.deepEqual(inside, expected);
						assert.deepEqual(await f.page.evaluate(environment), expected);
					}
					break;
				}
				case "/emulation-change": {
					await f.run(
						`async page => { await page.setViewportSize({width:500,height:300}); await page.emulateMedia({colorScheme:'light'}); }`,
					);
					assert.deepEqual(f.page.viewportSize(), { width: 500, height: 300 });
					const probe = () => ({
						width: screen.width,
						dark: matchMedia("(prefers-color-scheme: dark)").matches,
					});
					assert.deepEqual(await f.page.evaluate(probe), {
						width: 500,
						dark: false,
					});
					assert.deepEqual(
						await f.run(`async page=>page.evaluate(${probe.toString()})`),
						{ width: 500, dark: false },
					);
					await assert.rejects(
						f.run(
							`async page=>{await page.setViewportSize({width:600,height:400});throw new Error('after resize');}`,
						),
						/after resize/,
					);
					assert.deepEqual(f.page.viewportSize(), { width: 600, height: 400 });
					break;
				}
				case "/syntax": {
					await assert.rejects(f.run("async page => { broken syntax ??? }"));
					assert.equal(f.retired(), false);
					assert.equal(await f.run("async page => page.title()"), "");
					break;
				}
				case "/cancel": {
					const controller = new AbortController();
					const pending = f.run(
						`async page => page.evaluate(() => {
      document.body.dataset.started = 'yes';
      return new Promise(resolve => setTimeout(() => { document.body.dataset.late = 'yes'; resolve(null); },1000));
     })`,
						{ signal: controller.signal },
					);
					void pending.catch(() => {});
					await f.page.waitForFunction(
						() => document.body.dataset["started"] === "yes",
					);
					controller.abort(new Error("cancelled"));
					await assert.rejects(pending, /cancelled/);
					assert.equal(f.retired(), true);
					const response = await env.BROWSER.fetch(
						"http://fake.host/v1/sessions",
					);
					const sessions = (await response.json()) as {
						sessions: Array<{ sessionId: string }>;
					};
					assert.equal(
						sessions.sessions.some(
							(session) => session.sessionId === f.sessionId,
						),
						false,
					);
					break;
				}
				case "/init-script-limit":
				case "/output": {
					const source =
						new URL(request.url).pathname === "/output"
							? "async page => 'a'.repeat(1024)"
							: "async page => { await page.addInitScript('/*' + 'x'.repeat(65536) + '*/'); throw new Error('after oversized script'); }";
					await assert.rejects(
						f.run(source, { maxOutputBytes: 64 }),
						/(output|page state byte) limit/,
					);
					assert.equal(f.retired(), true);
					break;
				}
				default:
					throw new Error("Unknown native scenario");
			}
			return Response.json({ ok: true });
		} catch (error) {
			return Response.json(
				{
					error: String(error),
					stack: error instanceof Error ? error.stack : undefined,
				},
				{ status: 500 },
			);
		} finally {
			await f.cleanup();
		}
	},
};
