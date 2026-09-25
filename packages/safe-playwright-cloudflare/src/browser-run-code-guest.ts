import { WorkerEntrypoint } from "cloudflare:workers";
import { type Browser, connect, type Page } from "@cloudflare/playwright";
import { createRunCodeBinding } from "./browser-run-code-binding.js";
import { restoreRunCodeContextState } from "./browser-run-code-context-state.js";
import {
	type BrowserRunCodeMetadata,
	type BrowserRunCodeRelay,
} from "./browser-run-code-contract.js";
import {
	adoptRunCodeContext,
	captureRunCodeState,
	restoreRunCodePageState,
	runCodePageTarget,
} from "./browser-run-code-native.js";
import { serializeRunCodeState } from "./browser-run-code-state.js";
import { prepareBrowserScreenshots } from './browser-screenshot.js';

class RunCodeOutputLimitError extends Error {}

async function selectedPage(
	browser: Browser,
	metadata: BrowserRunCodeMetadata,
) {
	const observer = await browser.newBrowserCDPSession();
	let selected: Page | undefined;
	try {
		const { targetInfos } = await observer.send("Target.getTargets");
		const targets = new Map(
			targetInfos.map((target) => [target.targetId, target]),
		);
		await Promise.all(
			browser
				.contexts()
				.flatMap((context) => context.pages())
				.map(async (page) => {
					const id = runCodePageTarget(browser, page);
					if (targets.get(id)?.browserContextId !== metadata.contextId)
						throw new Error("Cannot adopt pages from another browser context");
					const state = metadata.state.pages.find(
						(value) => value.targetId === id,
					);
					if (!state)
						throw new Error("Owned run-code page state is unavailable");
					await restoreRunCodePageState(browser, page, state);
					if (id === metadata.targetId) selected = page;
				}),
		);
	} finally {
		await observer.detach();
	}
	if (!selected) throw new Error("Owned run-code page is unavailable");
	return selected;
}

function serializeResult(result: unknown): string {
	let json: string | undefined;
	try {
		json = JSON.stringify(result === undefined ? null : result);
	} catch {
		throw new Error("Run-code result is not JSON-serializable");
	}
	if (json === undefined)
		throw new Error("Run-code result is not JSON-serializable");
	return json;
}

export default class BrowserRunCodeGuest extends WorkerEntrypoint {
	async run(relay: BrowserRunCodeRelay, metadata: BrowserRunCodeMetadata) {
		const binding = createRunCodeBinding(relay);
		const connectOptions = { sessionId: "owned", persistent: true };
		const browser = await connect(binding as never, connectOptions);
		const failures: unknown[] = [];
		let userFailure: { error: unknown } | undefined;
		const response = await (async () => {
			adoptRunCodeContext(browser, metadata);
			await restoreRunCodeContextState(
				browser.contexts()[0]!,
				metadata.state.context
			);
			const page = await selectedPage(browser, metadata);
			prepareBrowserScreenshots(page);
			page.context().on("page", prepareBrowserScreenshots);
			let json: string;
			try {
				const { default: userCode } = await import("browser-user-code.js");
				if (typeof userCode !== "function")
					throw new Error("Run-code source must be a function");
				json = serializeResult(await userCode(page));
				if (Number.isFinite(metadata.maxOutputBytes) && new TextEncoder().encode(json).byteLength > metadata.maxOutputBytes!)
					throw new RunCodeOutputLimitError("Run-code output limit exceeded");
			} catch (error) {
				userFailure = { error };
				return {
					ok: false as const,
					message: String(error),
					...(error instanceof RunCodeOutputLimitError ? { outputLimit: true as const } : {}),
					stateJson: serializeRunCodeState(
						captureRunCodeState(browser, page.context())
					)
				};
			}
			return {
				ok: true as const,
				json,
				stateJson: serializeRunCodeState(
					captureRunCodeState(browser, page.context())
				)
			};
		})().catch((error: unknown) => {
			if (userFailure) failures.push(userFailure.error);
			failures.push(error);
		});
		// Stop forwarding frames before Playwright closes its local socket, then join
		// relay shutdown before releasing the guest that owns the callback capability.
		binding.revoke();
		for (const connection of [browser, binding]) {
			try {
				if (connection === browser && !browser.isConnected()) continue;
				await connection.close();
			} catch (error) {
				if (!failures.length && userFailure) failures.push(userFailure.error);
				failures.push(error);
			}
		}
		if (failures.length > 1)
			throw new AggregateError(failures, failures.map(String).join("; "), {
				cause: failures[0]
			});
		if (failures.length) throw failures[0];
		return response!;
	}
}
