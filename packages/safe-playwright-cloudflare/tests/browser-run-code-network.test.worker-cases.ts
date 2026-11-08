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
		const compressedResponse = await page.request.get(url + 'gzip', {timeout: 5000});
		const redirectResponse = await page.request.get(url + 'redirect', {timeout: 5000});
		const redirected = await redirectResponse.json();
		const binaryResponse = await page.request.get(url + 'binary', {timeout: 5000});
		const binary = await binaryResponse.body();
		const echoed = await page.context().request.post(url + 'binary', {data: binary, timeout: 5000});
		return {
			fetch: await fetched.json(),
			page: await pageResponse.json(),
			context: await contextResponse.json(),
			compressed: await compressedResponse.json(),
			compressedEncoding: compressedResponse.headers()['content-encoding'],
			redirect: {path: redirected.path, cookies: redirected.cookie.split('; ').sort()},
			binary: Array.from(binary),
			echoed: Array.from(await echoed.body()),
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
		compressed: { compressed: true },
		compressedEncoding: "gzip",
		redirect: { path: "/redirected", cookies: ["api-cookie=shared", "redirect-cookie=updated"] },
		binary: [0, 128, 255, 10],
		echoed: [0, 128, 255, 10],
	});
}
