import assert from "node:assert/strict";
import {
	acquire,
	type BrowserWorker,
	connect,
	type Page,
} from "@cloudflare/playwright";
import { createPlaywrightController } from "@poe-platform/safe-bash/playwright";
import type { PlaywrightSnapshotJSONNode, PlaywrightLease } from "@poe-platform/safe-bash/playwright";
import { captureBrowserSnapshotJSON } from "../src/browser-snapshot-json";
import { collectRendererCoverage } from "./browser-native-coverage.worker";
import { createCloudflarePlaywrightAdapter } from "../src/index";

function flatten(nodes: readonly PlaywrightSnapshotJSONNode[]) {
	const result = [...nodes];
	for (let index = 0; index < result.length; index++) {
		const node = result[index];
		if (node?.children) for (const child of node.children) if (typeof child !== "string") result.push(child);
	}
	return result;
}

export default {
	async fetch(request: Request, env: { BROWSER: BrowserWorker }) {
		if (new URL(request.url).pathname === "/handle-burst") {
			const lease = await createCloudflarePlaywrightAdapter(env.BROWSER).acquire({
				acquisitionId: "handle-burst",
				session: "handle-burst",
				browser: "chromium",
				headless: true,
				signal: new AbortController().signal,
			});
			try {
				const page = await lease.context.newPage();
				await page.setContent('<button onclick="this.dataset.clicked=\'yes\'">Button</button>'.repeat(1001));
				const handles = await page.locator("button").elementHandles();
				assert.equal(handles.length, 1001);
				await handles[1000]!.click();
				assert.equal(await handles[1000]!.getAttribute("data-clicked"), "yes");
				await Promise.all(handles.map(handle => handle.dispose()));
				assert.equal(page.isClosed(), false);
				await lease.release();
				assert.equal(page.isClosed(), true);
				return Response.json({ ok: true });
			} finally {
				await lease.release();
			}
		}
		const scenario = new URL(request.url).pathname;
		if (scenario.startsWith("/recover-") || scenario === "/unlimited-nodes") {
			const adapter = createCloudflarePlaywrightAdapter(env.BROWSER);
			let lease: PlaywrightLease | undefined;
			let acquisitions = 0;
			const controller = createPlaywrightController({
				adapter: { ...adapter, async acquire(options) {
					acquisitions++;
					lease = await adapter.acquire(options);
					return lease;
				} },
				...(scenario === "/recover-bytes" ? { limits: { maxSnapshotBytes: 512 } } : {}),
				...(scenario === "/recover-refs" ? { limits: { maxSnapshotRefs: 20000 } } : {}),
			});
			let output = "";
			const run = (args: string[]) => controller.run({ args, env: {}, signal: new AbortController().signal, async write(text) { output += text; } });
			try {
				await run(["open"]);
				assert.ok(lease);
				const page = lease.context.pages()[0]!;
				await page.setContent(["/recover-refs", "/unlimited-nodes"].includes(scenario)
					? "<button onclick=\"this.dataset.clicked='yes'\">Probe</button>".repeat(20001)
					: scenario === "/recover-frames"
						? '<iframe srcdoc="<button>Child</button>"></iframe>'.repeat(128)
						: `<p>${"x".repeat(2048)}</p>`);
				if (scenario === "/unlimited-nodes") {
					output = "";
					await run(["snapshot", "--json"]);
					assert.equal((output.match(/"role"\s*:\s*"button"/g) ?? []).length, 20001);
          const refs = [...output.matchAll(/"ref"\s*:\s*"(e\d+)"/g)].map(match => match[1]!);
          assert.ok(refs.length >= 20001);
          await run(['click', refs[0]!]);
          await run(['click', refs.at(-1)!]);
          assert.equal(await page.locator('button[data-clicked="yes"]').count(), 2);
				} else if (scenario === "/recover-frames") {
					output = "";
					await run(["snapshot", "--json"]);
					assert.equal((output.match(/"role"\s*:\s*"button"/g) ?? []).length, 128);
				} else {
					await assert.rejects(run(["snapshot", "--json"]), scenario === "/recover-refs" ? /Snapshot ref limit exceeded/ : /snapshot.*limit exceeded/i);
				}
				await run(["tab-list"]);
				assert.equal(lease.context.pages()[0], page);
				await page.setContent("<button>Recovered</button>");
				await run(["snapshot", "--json"]);
				assert.equal(acquisitions, 1);
				return Response.json({ ok: true });
			} catch (error) {
				return Response.json({ error: String(error) }, { status: 500 });
			} finally {
				await controller.dispose();
			}
		}
		if (["/public-frames", "/public-unlimited", "/public-identities"].includes(new URL(request.url).pathname)) {
			const lease = await createCloudflarePlaywrightAdapter(
				env.BROWSER,
			).acquire({
				acquisitionId: "frame-limit",
				session: "frame-limit",
				browser: "chromium",
				headless: true,
				signal: new AbortController().signal,
			});
			try {
				const page = await lease.context.newPage();
        if (scenario === '/public-identities') {
          const nativePage = page as unknown as Page;
          await nativePage.setContent('<button onclick="this.dataset.clicked=\'yes\'">Original</button><div id="shadow"></div><iframe srcdoc="<button>Child</button>"></iframe>');
          await nativePage.evaluate(() => { document.querySelector('#shadow')!.attachShadow({ mode: 'open' }).innerHTML = '<button>Shadow</button>'; });
          await nativePage.frameLocator('iframe').getByRole('button').waitFor();
          const tree = flatten(await lease.captureSnapshotJSON!(page, { signal: new AbortController().signal, timeoutMs: 5000, maxBytes: Infinity }));
          const refs = ['Original', 'Shadow', 'Child'].map(name => { const ref = tree.find(node => node.name === name)?.ref; assert.ok(ref); return ref; });
          const batch = await lease.captureSnapshotReferences!(page, refs, { signal: new AbortController().signal, timeoutMs: 5000 });
          await nativePage.getByRole('button', { name: 'Original' }).evaluate(node => { node.textContent = 'Renamed'; });
          await nativePage._snapshotForAI({ timeout: 5000 });
          assert.deepEqual(await batch.connected(), [true, true, true]);
          for (let index = 0; index < refs.length; index++) {
            const handle = await batch.resolve(index);
            assert.ok(handle);
            try { await handle.click(); } finally { await handle.dispose(); }
          }
          assert.equal(await nativePage.getByRole('button', { name: 'Renamed' }).getAttribute('data-clicked'), 'yes');
          await nativePage.getByRole('button', { name: 'Renamed' }).evaluate(node => { node.outerHTML = '<button>Replacement</button>'; });
          await nativePage._snapshotForAI({ timeout: 5000 });
          assert.deepEqual(await batch.connected(), [false, true, true]);
          assert.equal(await batch.resolve(0), null);
          const child = nativePage.frames().find(frame => frame !== nativePage.mainFrame())!;
          const originalLocator = child.locator;
          let raced = false;
          child.locator = function (...args) {
            const locator = originalLocator.apply(this, args);
            if (!raced && args[0].startsWith('aria-ref=')) locator.elementHandles = async () => {
              raced = true;
              await child.goto('data:text/html,<button>New Child</button>');
              return originalLocator.call(child, 'button').elementHandles();
            };
            return locator;
          };
          try { assert.equal(await batch.resolve(2), null); }
          finally { child.locator = originalLocator; }
          assert.equal(raced, true);
          const changed = flatten(await lease.captureSnapshotJSON!(page, { signal: new AbortController().signal, timeoutMs: 5000, maxBytes: Infinity }));
          const childRef = changed.find(node => node.name === 'New Child')?.ref;
          assert.ok(childRef);
          const replacement = await lease.captureSnapshotReferences!(page, [childRef], { signal: new AbortController().signal, timeoutMs: 5000 });
          assert.notEqual(replacement.identities[0]!.scope, batch.identities[2]!.scope);
          assert.deepEqual(await batch.connected(), [false, true, false]);
          return Response.json({ ok: true });
        }
				if (new URL(request.url).pathname === "/public-unlimited") {
					const text = "x".repeat(300 * 1024);
					await page.setContent(`<p>${text}</p>`);
					const tree = await lease.captureSnapshotJSON!(page, {
						signal: new AbortController().signal,
						timeoutMs: 15000,
						maxBytes: Infinity,
					});
					assert.ok(JSON.stringify(tree).includes(text));
					assert.equal(await page.evaluate(() => document.querySelector("p")?.textContent), text);
					return Response.json({ ok: true });
				}
				await page.setContent(
					'<iframe srcdoc="<button>Child</button>"></iframe>'.repeat(128),
				);
				const tree = await lease.captureSnapshotJSON!(page, {
					signal: new AbortController().signal,
					timeoutMs: 15000,
					maxBytes: 1048576,
				});
				assert.equal(flatten(tree).filter(node => node.role === "button").length, 128);
				assert.equal(page.isClosed(), false);
				await lease.release();
				assert.equal(page.isClosed(), true);
				return Response.json({ ok: true });
			} catch (error) {
				return Response.json({ error: String(error) }, { status: 500 });
			} finally {
				await lease.release();
			}
		}
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
						/snapshot byte limit/,
					);
					assert.ok((await captureBrowserSnapshotJSON(page, options)).length);
					break;
				case "/frames": {
					await page.setContent(
						'<iframe srcdoc="<button>Child</button>"></iframe>'.repeat(128),
					);
					const tree = await captureBrowserSnapshotJSON(page, {
						...options,
						timeoutMs: 15000,
						maxBytes: 1024 * 1024,
					});
					assert.equal(flatten(tree).filter(node => node.role === "button").length, 128);
					break;
				}
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
