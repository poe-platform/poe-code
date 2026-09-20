import assert from "node:assert/strict";
import type { BrowserContext } from "@cloudflare/playwright";

export async function assertRunCodeNetwork(
	fixture: {
		context: BrowserContext;
		run(source: string): Promise<unknown>;
	},
	url: string,
) {
	await fixture.context.addCookies([
		{ name: "api-cookie", value: "shared", url },
	]);
	const result = await fixture.run(`async page => {
		const url = ${JSON.stringify(url)};
		const fetched = await fetch(url + 'fetch');
		const pageResponse = await page.request.get(url + 'page', {timeout: 5000});
		const contextResponse = await page.context().request.post(url + 'context', {data: 'native-body', timeout: 5000});
		return {
			fetch: await fetched.json(),
			page: await pageResponse.json(),
			context: await contextResponse.json(),
		};
	}`);
	assert.deepEqual(result, {
		fetch: { path: "/fetch", method: "GET", cookie: null, body: "" },
		page: {
			path: "/page",
			method: "GET",
			cookie: "api-cookie=shared",
			body: "",
		},
		context: {
			path: "/context",
			method: "POST",
			cookie: "api-cookie=shared",
			body: "native-body",
		},
	});
}
