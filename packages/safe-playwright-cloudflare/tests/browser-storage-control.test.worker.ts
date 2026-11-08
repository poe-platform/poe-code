import assert from "node:assert/strict";
import type { BrowserWorker } from "@cloudflare/playwright";
import { acquireCloudflareBrowser } from "../src/shell-browser-resource";
import { createBrowserStorageControl } from "../src/browser-storage-control";
import { failureText } from "./browser-native-failure";

export default {
	async fetch(request: Request, env: { BROWSER: BrowserWorker }) {
		const signal = new AbortController().signal;
		const resource = await acquireCloudflareBrowser({ binding: env.BROWSER, signal });
		try {
			const context = await resource.browser.newContext();
			const page = await context.newPage();
			await page.setContent('<title>Storage control</title><p id="witness">retained</p>');
			let transferredBytes = 0;
			if (new URL(request.url).pathname === "/owned-unlimited") {
				const cdp = await context.newCDPSession(page);
				const { targetInfo } = await cdp.send("Target.getTargetInfo");
				await cdp.detach();
				assert.ok(targetInfo.browserContextId);
				const lease = await resource.prepareStorageOrigin({
					context,
					browserContextId: targetInfo.browserContextId,
					origin: "https://storage-control.invalid",
					signal,
				});
				try {
					const { frameTree } = await lease.cdp.send("Page.getFrameTree");
					const { executionContextId } = await lease.cdp.send("Page.createIsolatedWorld", {
						frameId: (frameTree as { frame: { id: string } }).frame.id,
						worldName: "safe-bash-native-storage",
					});
					const value = "x".repeat(17 * 1024 * 1024);
					const results = await Promise.all([0, 1].map(() => lease.cdp.send("Runtime.evaluate", {
						expression: JSON.stringify(value), contextId: executionContextId, returnByValue: true,
					})));
					for (const result of results) assert.deepEqual(result.result, { type: "string", value });
					transferredBytes = 2 * value.length;
				} finally {
					await lease.release();
				}
			} else {
				const control = createBrowserStorageControl({
					socket: await resource.connectSocket(signal),
					limits: { maxMessageBytes: 1024, maxPendingCommands: 1 },
				});
				try {
					const version = control.send("Browser.getVersion");
					await assert.rejects(control.send("Browser.getVersion"), /maxPendingCommands: 1/);
					assert.equal(typeof (await version).product, "string");
					await assert.rejects(control.send("Runtime.evaluate", { expression: "x".repeat(1025) }), /maxMessageBytes: 1024/);
					assert.equal(typeof (await control.send("Browser.getVersion")).product, "string");
				} finally {
					await control.close();
				}
			}
			assert.deepEqual(context.pages(), [page]);
			assert.equal(page.context(), context);
			assert.equal(await page.title(), "Storage control");
			assert.equal(await page.locator("#witness").textContent(), "retained");
			return Response.json({ ok: true, transferredBytes });
		} catch (error) {
			return Response.json({ error: failureText(error) }, { status: 500 });
		} finally {
			await resource.release();
		}
	},
};
