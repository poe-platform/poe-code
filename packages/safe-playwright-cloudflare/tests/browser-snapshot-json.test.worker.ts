import assert from "node:assert/strict";
import {
	acquire,
	type BrowserWorker,
	connect,
	type Page,
} from "@cloudflare/playwright";
import type { PlaywrightSnapshotJSONNode } from "@poe-platform/safe-bash/playwright";
import { captureBrowserSnapshotJSON } from "../src/browser-snapshot-json";
import { collectRendererCoverage } from "./browser-native-coverage.worker";

function flatten(nodes: readonly PlaywrightSnapshotJSONNode[]) {
	const result = [...nodes];
	for (let index = 0; index < result.length; index++) {
		const node = result[index];
		if (node?.children) result.push(...node.children);
	}
	return result;
}

export default {
	async fetch(request: Request, env: { BROWSER: BrowserWorker }) {
		const { sessionId } = await acquire(env.BROWSER, {});
		const browser = await connect(env.BROWSER, sessionId);
		let page: Page | undefined;
		try {
			page = await browser.newPage();
			const name = "Long accessible name ".repeat(60);
			await page.setContent(`<main aria-label="Main region">
<button style="position:absolute;left:8.3px;top:8.7px;width:30.5px;height:12.5px;padding:0;border:0" aria-label="${name.trim()}" onclick="this.dataset.clicked='yes'">Owner</button>
<input type="checkbox" aria-label="Unchecked">
<button disabled>Disabled</button><input aria-label="Input" placeholder="Type here">
<a href="/relative">Link</a>
<iframe srcdoc="<button onclick=&quot;this.dataset.clicked='yes'&quot;>Child</button>"></iframe>
</main>`);
			await page.frameLocator("iframe").getByRole("button").waitFor();
			const options = {
				signal: new AbortController().signal,
				timeoutMs: 5000,
				maxBytes: 65536,
			};
			switch (new URL(request.url).pathname) {
				case "/fidelity": {
					const tree = await captureBrowserSnapshotJSON(page, options);
					const nodes = flatten(tree);
					const owner = nodes.find((node) => node.name === name.trim());
					assert.equal(owner?.role, "button");
					assert.ok(owner?.ref);
					assert.equal(owner.box, undefined);
					assert.equal(
						nodes.find((node) => node.name === "Unchecked")?.checked,
						undefined,
					);
					assert.equal(
						nodes.find((node) => node.name === "Disabled")?.disabled,
						true,
					);
					assert.equal(
						nodes.find((node) => node.name === "Input")?.placeholder,
						"Type here",
					);
					assert.equal(
						nodes.find((node) => node.name === "Link")?.url,
						"/relative",
					);
					await page.locator(`aria-ref=${owner.ref}`).click();
					assert.equal(
						await page
							.getByRole("button", { name: name.trim() })
							.getAttribute("data-clicked"),
						"yes",
					);
					const iframe = nodes.find((node) => node.role === "iframe");
					const child = iframe?.children?.find((node) => node.name === "Child");
					assert.ok(child?.ref);
					await page
						.frameLocator("iframe")
						.locator(`aria-ref=${child.ref}`)
						.click();
					assert.equal(
						await page
							.frameLocator("iframe")
							.getByRole("button")
							.getAttribute("data-clicked"),
						"yes",
					);
					const boxes = flatten(
						await captureBrowserSnapshotJSON(page, { ...options, boxes: true }),
					);
					const boxed = boxes.find((node) => node.name === name.trim());
					assert.ok(boxed?.box && boxed.box.width > 0 && boxed.box.height > 0);
					assert.equal(boxed.ref, owner.ref);
					assert.deepEqual(boxed.box, { x: 8, y: 9, width: 31, height: 13 });
					break;
				}
				case "/bounds":
					await assert.rejects(
						captureBrowserSnapshotJSON(page, { ...options, maxBytes: 128 }),
						/snapshot JSON limit/,
					);
					assert.ok((await captureBrowserSnapshotJSON(page, options)).length);
					break;
				case "/frames":
					await page.setContent(
						'<iframe srcdoc="<button>Child</button>"></iframe>'.repeat(128),
					);
					await assert.rejects(
						captureBrowserSnapshotJSON(page, {
							...options,
							timeoutMs: 15000,
							maxBytes: 1024 * 1024,
						}),
						/snapshot frame limit/,
					);
					break;
				case "/abort":
					await assert.rejects(
						captureBrowserSnapshotJSON(page, {
							...options,
							signal: AbortSignal.abort(new Error("Snapshot cancelled")),
						}),
						/Snapshot cancelled/,
					);
					break;
				default:
					throw new Error("Unknown snapshot scenario");
			}
			return Response.json({ ok: true });
		} catch (error) {
			return Response.json(
				{
					error: String(error),
					stack: error instanceof Error ? error.stack : "",
				},
				{ status: 500 },
			);
		} finally {
			try {
				if (page) await collectRendererCoverage(browser, page);
			} finally {
				await browser.close();
			}
		}
	},
};
