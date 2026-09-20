import assert from "node:assert/strict";
import type { Page } from "@cloudflare/playwright";
import { captureRunCodeTimeouts } from "../src/browser-run-code-native";

export async function assertRunCodeSerialization(f: {
	page: Page;
	run(source: string): Promise<unknown>;
	retired(): boolean;
}) {
	const returns = [
		"return 1n;",
		"const result = {}; result.self = result; return result;",
		"return () => {};",
		"return Symbol('result');",
		"return { toJSON() { throw new Error('custom serialization'); } };",
	];
	for (const [index, statement] of returns.entries()) {
		const registrations = index + 1;
		const width = 650 + index;
		const action = 4000 + index;
		const navigation = 5000 + index;
		// biome-ignore lint/performance/noAwaitInLoops: Each failure and recovery must finish on the same owned browser before the next mutation tests retained state.
		await assert.rejects(
			f.run(`async page => {
        page.setDefaultTimeout(${action});
        page.setDefaultNavigationTimeout(${navigation});
        await page.setViewportSize({width:${width},height:480});
        await page.addInitScript('window.pageBoot = (window.pageBoot || 0) + 1');
        await page.context().addInitScript('window.contextBoot = (window.contextBoot || 0) + 1');
        await page.evaluate(() => { document.title = 'Attempt ${registrations}'; });
        ${statement}
      }`),
			/result is not JSON-serializable/,
		);
		assert.equal(f.retired(), false);
		assert.equal(await f.page.title(), `Attempt ${registrations}`);
		assert.deepEqual(f.page.viewportSize(), { width, height: 480 });
		assert.deepEqual(captureRunCodeTimeouts(f.page), { action, navigation });
		await f.page.goto(
			`data:text/html,<title>Recovered ${registrations}</title>`,
		);
		assert.deepEqual(
			await f.run(`async page => ({
        title: await page.title(),
        viewport: page.viewportSize(),
        boots: await page.evaluate(() => ({page:window.pageBoot,context:window.contextBoot}))
      })`),
			{
				title: `Recovered ${registrations}`,
				viewport: { width, height: 480 },
				boots: { page: registrations, context: registrations },
			},
		);
	}
	// Native Playwright objects provide toJSON and are valid JSON results.
	const nativePage = (await f.run(`async page => {
    await page.evaluate(() => { document.title = 'Native page result'; });
    return page;
  }`)) as { _type: string; _guid: string };
	assert.deepEqual(Object.keys(nativePage).sort(), ["_guid", "_type"]);
	assert.equal(nativePage._type, "Page");
	assert.equal(typeof nativePage._guid, "string");
	assert.notEqual(nativePage._guid, "");
	assert.equal(await f.page.title(), "Native page result");
	// Ordinary void results retain their existing JSON-null representation.
	assert.equal(await f.run("async page => {}"), null);
	assert.equal(f.retired(), false);
}
