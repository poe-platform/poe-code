import { failureText } from "./browser-native-failure";
import { RpcTarget } from "cloudflare:workers";
import assert from "node:assert/strict";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { createPlaywrightCli } from "@poe-platform/safe-bash/playwright";
import {
	acquire,
	type BrowserWorker,
	connect,
	type Page,
} from "@cloudflare/playwright";
import { browserPageCDP } from "../src/browser-page-cdp";
import { createBrowserRunCode } from "../src/browser-run-code";
import type { BrowserRunCodeMetadata, BrowserRunCodeReceiver, BrowserRunCodeRelay } from "../src/browser-run-code-contract";
import type BrowserRunCodeGuest from "../src/browser-run-code-guest";
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

function trailingFrameLoader(loader: WorkerLoader): WorkerLoader {
	return {
		load(options: Parameters<WorkerLoader["load"]>[0]) {
			const worker = loader.load(options);
			return {
				getEntrypoint() {
					const entry = worker.getEntrypoint<BrowserRunCodeGuest>();
					return {
						run(relay: BrowserRunCodeRelay, metadata: BrowserRunCodeMetadata) {
							class Relay extends RpcTarget {
								open(url: string, callback: BrowserRunCodeReceiver) {
									const retained = callback.dup();
									const receiver: BrowserRunCodeReceiver = {
										frame: retained.frame,
										async close() {
											// Deterministically deliver one trailing CDP reply during draining.
											// Playwright ignores replies for sessions already detached (-32001).
											await retained.frame('{"id":2147483647,"error":{"code":-32001,"message":"Session with given id not found."}}');
											await retained.close();
										},
										dup: () => receiver,
										[Symbol.dispose]: retained[Symbol.dispose].bind(retained),
									};
									return relay.open(url, receiver);
								}
							}
							return entry.run(new Relay(), metadata);
						},
					};
				},
			};
		},
	} as unknown as WorkerLoader;
}

async function fixture(env: Env, mobile: boolean, loader = env.BROWSER_RUN_CODE_LOADER) {
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
		loader,
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
		execute,
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
		const failures: unknown[] = [];
		let cleanup: (() => Promise<void>) | undefined;
		try {
			const storage = await handleBrowserStorageScenario(request, env);
			if (storage) return storage;
			const f = await fixture(
				env,
				new URL(request.url).pathname.startsWith("/mobile"),
				new URL(request.url).pathname === '/loader-error'
					? { load() { throw new Error('Worker transport unavailable'); } } as unknown as WorkerLoader
					: new URL(request.url).pathname === '/serialization-trailing-frame'
						? trailingFrameLoader(env.BROWSER_RUN_CODE_LOADER)
						: env.BROWSER_RUN_CODE_LOADER,
			);
			cleanup = f.cleanup;
			switch (new URL(request.url).pathname) {
				case "/foreign-context": {
					const foreignContext = await f.browser.newContext();
					const foreignPage = await foreignContext.newPage();
					const foreignCDP = await browserPageCDP(foreignPage);
					const { targetInfo: foreign } = await foreignCDP.send("Target.getTargetInfo");
					const ownedCDP = await browserPageCDP(f.page);
					const { targetInfo: owned } = await ownedCDP.send("Target.getTargetInfo");
					await assert.rejects(f.run("async page => 1n"), error => {
						assert.ok(error instanceof Error);
						const prefix = "Run-code cannot reconnect another existing browser context: ";
						assert.ok(error.message.startsWith(prefix), error.message);
						const census = JSON.parse(error.message.slice(prefix.length));
						assert.equal(census.ownedTargetId, owned.targetId);
						assert.equal(census.ownedContextId, owned.browserContextId);
						assert.ok(census.browserContextIds.includes(foreign.browserContextId));
						assert.ok(census.foreignTargets.some((target: { targetId: string; contextId: string; urlState: string; isPrivateContext: boolean }) =>
							target.targetId === foreign.targetId && target.contextId === foreign.browserContextId && target.urlState === "about:blank" && target.isPrivateContext));
						return true;
					});
					assert.equal(f.retired(), true);
					break;
				}
				case "/default-target": {
					const cdp = await f.browser.newBrowserCDPSession();
					const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
					assert.equal(await f.run("async page => page.title()"), "");
					const { targetInfos } = await cdp.send("Target.getTargets");
					assert.equal(targetInfos.some(target => target.targetId === targetId), false);
					assert.equal(f.retired(), false);
					await cdp.detach();
					break;
				}
				case "/serialization-after-context-close": {
					const extra = await f.browser.newContext();
					await extra.newPage();
					await extra.close();
					await assertRunCodeSerialization(f);
					break;
				}
				case "/serialization":
				case "/serialization-trailing-frame":
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
					const fs = new MemoryFileSystem();
					const shell = new Shell({ fs });
					shell.use(createPlaywrightCli({ adapter: {
						browsers: { chromium: { headed: false } },
						async acquire() { return { context: f.context, executeCode: f.execute, onClosed() { return () => {}; }, async release() {} }; },
					} }).plugin);
					try {
						assert.equal((await shell.exec('playwright-cli open')).exitCode, 0);
						for (const source of [
							'await page.evaluate(() => { document.title = "bare statement"; }); return await page.title();',
							'async (page) => { await page.evaluate(() => { document.title = "function expression"; }); return await page.title(); }',
							'await page.title()',
						]) {
							const result = await shell.exec(`playwright-cli run-code '${source}'`);
							assert.equal(result.exitCode, 0, result.stdout + result.stderr);
							assert.ok(result.stdout.includes(source.includes('bare statement') ? 'bare statement' : 'function expression'), result.stdout);
						}
						await fs.writeFile('/script.js', new TextEncoder().encode('const title = await page.title(); return { title };'));
						const fromFile = await shell.exec('playwright-cli run-code --filename=/script.js');
						assert.equal(fromFile.exitCode, 0, fromFile.stdout + fromFile.stderr);
						assert.ok(fromFile.stdout.includes('function expression'), fromFile.stdout);
						for (const source of ['const x = ;', 'async page => { broken syntax ??? }']) {
							const result = await shell.exec(`playwright-cli run-code '${source}'`);
							assert.equal(result.exitCode, 1);
							assert.ok((result.stdout + result.stderr).includes('SyntaxError'), result.stdout + result.stderr);
							assert.ok((result.stdout + result.stderr).includes('async (page) => { return await page.title(); }'), result.stdout + result.stderr);
						}
						const recovered = await shell.exec('playwright-cli run-code "async (page) => { return await page.title(); }"');
						assert.equal(recovered.exitCode, 0, recovered.stderr);
						for (const source of ['async page => { throw new Error("user failure"); }', 'async page => { throw new SyntaxError("user syntax failure"); }', 'await page.evaluate(() => { document.title += "!"; }); throw new SyntaxError("bare user failure");']) {
							const result = await shell.exec(`playwright-cli run-code '${source}'`);
							assert.equal(result.exitCode, 1);
							assert.ok((result.stdout + result.stderr).includes('failure'));
							assert.ok(!(result.stdout + result.stderr).includes('async (page)'));
						}
						const exactlyOnce = await shell.exec('playwright-cli run-code "async page => page.title()"');
						assert.ok(exactlyOnce.stdout.includes('function expression!'), exactlyOnce.stdout);
						assert.ok(!exactlyOnce.stdout.includes('function expression!!'), exactlyOnce.stdout);
						assert.equal((await shell.exec('playwright-cli run-code "async page => page.title()"')).exitCode, 0);
					} finally { await shell.dispose(); }
					assert.equal(f.retired(), false);
					assert.equal(await f.run("async page => page.title()"), "");
					break;
				}
				case "/loader-error": {
					await assert.rejects(f.run('async page => page.title()'), error => {
						assert.ok(String(error).includes('Worker transport unavailable'));
						assert.ok(!String(error).includes('expects one JavaScript function'));
						assert.ok(!String(error).includes('SyntaxError'));
						return true;
					});
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
				case "/init-script-limit": {
					await assert.rejects(
						f.run("async page => { await page.addInitScript('window.largeScript = true; /*' + 'x'.repeat(65536) + '*/'); throw new Error('after large script'); }"),
						/after large script/,
					);
					assert.equal(f.retired(), false);
					await f.page.goto('data:text/html,<title>Large script</title>');
					assert.equal(await f.page.evaluate('window.largeScript'), true);
					break;
				}
				case "/output": {
					await assert.rejects(
						f.run(`async page => {
              await page.setViewportSize({ width: 650, height: 480 });
              await page.addInitScript('window.outputRecovered = true');
              await page.evaluate(() => { document.title = 'Output retained'; });
              return 'a'.repeat(1024);
            }`, { maxOutputBytes: 64 }),
						/output limit/,
					);
					assert.equal(f.retired(), false);
					assert.equal(f.browser.contexts()[0], f.context);
					assert.equal(f.context.pages()[0], f.page);
					assert.equal(await f.page.title(), "Output retained");
					assert.deepEqual(f.page.viewportSize(), { width: 650, height: 480 });
					await f.page.goto('data:text/html,<title>Output recovered</title>');
					assert.equal(await f.page.evaluate('window.outputRecovered'), true);
					assert.equal(await f.run("async page => page.title()"), "Output recovered");
					break;
				}
				case "/output-cli": {
					const shell = new Shell({ fs: new MemoryFileSystem() });
					let releases = 0;
					shell.use(createPlaywrightCli({ limits: { maxCommandBytes: 1024 }, adapter: {
						browsers: { chromium: { headed: false } },
						async acquire() { return { context: f.context, executeCode: f.execute,
							onClosed() { return () => {}; }, async release() { releases++; } }; },
					} }).plugin);
					try {
						assert.equal((await shell.exec('playwright-cli open')).exitCode, 0);
						const result = await shell.exec(`playwright-cli run-code 'async page => {
              await page.evaluate(() => { document.title = "CLI output retained"; });
              return "x".repeat(2048);
            }'`);
						assert.equal(result.exitCode, 1);
						assert.ok((result.stdout + result.stderr).includes('output limit'), result.stdout + result.stderr);
						assert.equal(releases, 0, 'A completed output refusal must not release the CLI session');
						assert.equal(f.retired(), false);
						assert.equal((await shell.exec('playwright-cli tab-list')).exitCode, 0);
						const recovered = await shell.exec(`playwright-cli run-code 'async page => page.title()'`);
						assert.equal(recovered.exitCode, 0, recovered.stdout + recovered.stderr);
						assert.ok(recovered.stdout.includes('CLI output retained'), recovered.stdout);
					} finally { await shell.dispose(); }
					break;
				}
				case "/unlimited-source-output": {
					const result = await f.execute({
						page: f.page, signal: new AbortController().signal,
						source: `async page => { /*${"x".repeat(1024 * 1024)}*/ return 'x'.repeat(17 * 1024 * 1024); }`,
					});
					assert.equal(result, "x".repeat(17 * 1024 * 1024));
					assert.equal(f.retired(), false);
					assert.equal(await f.run("async page => page.title()"), "");
					break;
				}
				case "/unlimited-contexts": {
					const result = await f.execute({
						page: f.page, signal: new AbortController().signal,
						source: `async page => {
              const browser = page.context().browser();
              const contexts = await Promise.all(Array.from({ length: 17 }, () => browser.newContext()));
              const count = browser.contexts().length;
              await Promise.all(contexts.map(context => context.close()));
              return count;
            }`,
					});
					assert.equal(result, 18);
					assert.equal(f.retired(), false);
					assert.equal(await f.run("async page => page.title()"), "");
					break;
				}
				default:
					throw new Error("Unknown native scenario");
			}
		} catch (error) {
			failures.push(error);
		} finally {
			try {
				await cleanup?.();
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length) {
			const error = failures[0];
			return Response.json(
				{
					error: failures.map(failureText).join("; "),
					stack: error instanceof Error ? error.stack : undefined,
				},
				{ status: 500 },
			);
		}
		return Response.json({ ok: true });
	},
};
