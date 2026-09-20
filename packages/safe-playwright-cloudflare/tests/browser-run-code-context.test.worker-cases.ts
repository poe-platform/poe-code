import assert from "node:assert/strict";
import type { BrowserContext, Page } from "@cloudflare/playwright";

async function coordinates(page: Page) {
	return page.evaluate(
		() =>
			new Promise((resolve) => {
				navigator.geolocation.getCurrentPosition(
					(position) =>
						resolve([position.coords.latitude, position.coords.longitude]),
					(error) => resolve(error.message),
					{ timeout: 500 },
				);
			}),
	);
}

export async function assertRunCodeContextMutations(f: {
	context: BrowserContext;
	page: Page;
	run(source: string): Promise<unknown>;
}) {
	const headers: Record<string, string>[] = [];
	await f.context.route("https://example.com/**", async (route) => {
		headers.push(route.request().headers());
		await route.fulfill({ status: 200, body: "OK" });
	});
	await f.context.grantPermissions(["geolocation"], {
		origin: "https://example.com",
	});
	await f.page.goto("https://example.com/initial");
	await f.run(`async page => {
    await page.context().setExtraHTTPHeaders({'x-context-probe':'first'});
    await page.context().setGeolocation({latitude:12.5,longitude:34.5});
    await page.context().setOffline(true);
  }`);
	assert.equal(await f.page.evaluate(() => navigator.onLine), false);
	const next = await f.context.newPage();
	assert.equal(await next.evaluate(() => navigator.onLine), false);
	await f.context.setOffline(false);
	await next.goto("https://example.com/next");
	assert.equal(headers.at(-1)?.["x-context-probe"], "first");
	assert.deepEqual(await coordinates(next), [12.5, 34.5]);
	await f.page.reload();
	assert.equal(headers.at(-1)?.["x-context-probe"], "first");
	assert.deepEqual(await coordinates(f.page), [12.5, 34.5]);
	await assert.rejects(
		f.run(`async page => {
    await page.context().setExtraHTTPHeaders({});
    await page.context().setGeolocation(null);
    await page.context().setOffline(false);
    throw new Error('after context mutation');
  }`),
		/after context mutation/,
	);
	assert.equal(await f.page.evaluate(() => navigator.onLine), true);
	await next.reload();
	assert.equal(headers.at(-1)?.["x-context-probe"], undefined);
	assert.equal(typeof (await coordinates(next)), "string");
}
