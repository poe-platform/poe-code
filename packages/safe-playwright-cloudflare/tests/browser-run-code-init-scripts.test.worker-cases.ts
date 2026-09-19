import assert from "node:assert/strict";
import type { Browser, BrowserContext, Page } from "@cloudflare/playwright";
import { captureRunCodeState } from "../src/browser-run-code-native";
import type { RunCodeState } from "../src/browser-run-code-state";

interface Fixture {
	browser: Browser;
	context: BrowserContext;
	page: Page;
	run(source: string, options?: { page?: Page }): Promise<unknown>;
	retired(): boolean;
	retiredState(): RunCodeState | undefined;
}

const increment = "window.bootCount = (window.bootCount || 0) + 1";
function batch(target: string, count: number, after = "") {
	return `async page => {
    await Promise.all(Array.from({length:${count}}, () => ${target}.addInitScript(${JSON.stringify(increment)})));
    ${after}
  }`;
}
async function executions(page: Page) {
	await page.goto("data:text/html,<title>Retained scripts</title>");
	return page.evaluate("window.bootCount");
}

export async function assertRunCodeInitScriptRetention(
	f: Fixture,
	scenario: string,
) {
	switch (scenario) {
		case "/init-scripts": {
			await f.context.addInitScript(
				"window.parentInit = (window.parentInit || 0) + 1",
			);
			await f.run(`async page => {
            const source = 'window.bootCount = (window.bootCount || 0) + 1';
            await page.addInitScript(source);
            await page.addInitScript(source);
            await page.context().addInitScript('window.contextCount = (window.contextCount || 0) + 1');
          }`);
			const probe =
				"({boot:window.bootCount,context:window.contextCount,parent:window.parentInit})";
			const expected = { boot: 2, context: 1, parent: 1 };
			await f.page.goto("data:text/html,<title>Initial</title>");
			assert.deepEqual(await f.page.evaluate(probe), expected);
			assert.deepEqual(
				await f.run(`async page => {
            await page.goto('data:text/html,<title>Repeated</title>');
            return page.evaluate(${JSON.stringify(probe)});
          }`),
				expected,
			);
			await f.page.reload();
			assert.deepEqual(await f.page.evaluate(probe), expected);
			await assert.rejects(
				f.run(`async page => {
            await page.context().addInitScript('window.contextCount = (window.contextCount || 0) + 10');
            throw new Error('after init script');
          }`),
				/after init script/,
			);
			await f.run(`async page => {
            await page.context().addInitScript('window.contextCount = (window.contextCount || 0) + 100');
            await page.close();
          }`);
			assert.equal(f.context.pages().length, 0);
			const extra = await f.context.newPage();
			await extra.goto("data:text/html,<title>New page</title>");
			assert.deepEqual(await extra.evaluate(probe), {
				boot: undefined,
				context: 111,
				parent: 1,
			});
			break;
		}
		case "/init-script-context-retention":
			await f.run(batch("page.context()", 128));
			await f.run(batch("page.context()", 128));
			assert.equal(await executions(f.page), 256);
			await assert.rejects(
				f.run(batch("page.context()", 1)),
				/retained init script limit exceeded/,
			);
			assert.equal(f.retired(), true);
			assert.equal(f.retiredState()?.contextInitScripts.length, 256);
			break;
		case "/init-script-page-retention":
			// Include an existing host registration and preserve guest registrations
			// even when user code throws, without duplicating them on reconnect.
			await f.context.addInitScript(increment);
			await f.run(batch("page", 127));
			await assert.rejects(
				f.run(batch("page", 128, "throw new Error('after registration')")),
				/after registration/,
			);
			assert.equal(f.retired(), false);
			assert.equal(await executions(f.page), 256);
			await assert.rejects(
				f.run(
					batch(
						"page.context()",
						1,
						"await page.addInitScript('0'); throw new Error('over capacity')",
					),
				),
				/retained init script limit exceeded/,
			);
			assert.equal(f.retired(), true);
			// Neither the context nor the page portion of a rejected batch transfers.
			assert.equal(f.retiredState()?.contextInitScripts.length, 1);
			assert.equal(f.retiredState()?.pages[0]?.initScripts.length, 255);
			break;
		case "/init-script-byte-retention": {
			// 32 KiB retained: 32,718 UTF-8 source bytes + two native 25-byte
			// wrappers (guest registration, then retained-host registration).
			const source = `//${"é".repeat(16358)}`;
			const register = `await page.context().addInitScript(${JSON.stringify(source)})`;
			const retainedBytes = () =>
				captureRunCodeState(f.browser, f.context).contextInitScripts.reduce(
					(bytes, script) =>
						bytes + new TextEncoder().encode(script).byteLength,
					0,
				);
			await f.run(`async page => { ${register}; }`);
			assert.equal(retainedBytes(), 32 * 1024);
			await assert.rejects(
				f.run(`async page => { ${register}; throw new Error('after bytes'); }`),
				/after bytes/,
			);
			assert.equal(f.retired(), false);
			assert.equal(retainedBytes(), 64 * 1024);
			await assert.rejects(
				f.run("async page => { await page.addInitScript('0'); }"),
				/retained init script limit exceeded/,
			);
			assert.equal(f.retired(), true);
			break;
		}
		case "/init-script-page-close-capacity": {
			const extra = await f.context.newPage();
			// Reconnect can reorder pages; identity within each connection is stable.
			await f.run(`async page => {
        const extra = page.context().pages().find(other => other !== page);
        if (!extra) throw new Error('Extra page missing');
        await (${batch("extra", 256)})(page);
      }`);
			assert.equal(await executions(extra), 256);
			assert.equal(await executions(f.page), undefined);
			await f.run(`async page => {
        const extra = page.context().pages().find(other => other !== page);
        if (!extra) throw new Error('Extra page missing');
        await extra.close();
        await (${batch("page", 256)})(page);
      }`);
			assert.equal(f.retired(), false);
			assert.equal(extra.isClosed(), true);
			assert.equal(f.page.isClosed(), false);
			assert.equal(f.context.pages().length, 1);
			assert.equal(await executions(f.page), 256);
			break;
		}
		case "/init-script-context-close-capacity": {
			await f.run(batch("page.context()", 256));
			await f.run(batch("page.context()", 1, "await page.context().close()"));
			assert.equal(f.retired(), false);
			assert.equal(f.browser.contexts().includes(f.context), false);
			const context = await f.browser.newContext();
			const page = await context.newPage();
			await f.run(batch("page.context()", 256), { page });
			assert.equal(f.retired(), false);
			assert.equal(await executions(page), 256);
			break;
		}
		default:
			throw new Error(`Unknown init script scenario: ${scenario}`);
	}
}
