import { RpcTarget, WorkerEntrypoint } from "cloudflare:workers";
import { type Browser, connect, type Page } from "@cloudflare/playwright";
import { restoreRunCodeContextState } from "./browser-run-code-context-state.js";
import {
	BROWSER_RUN_CODE_URL,
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

class Receiver extends RpcTarget {
	#socket: WebSocket;
	constructor(socket: WebSocket) {
		super();
		this.#socket = socket;
	}
	frame(message: string) {
		this.#socket.send(message);
	}
	close() {
		try {
			this.#socket.close();
		} catch {
			/* Already closed. */
		}
	}
}

async function bindingResponse(relay: BrowserRunCodeRelay, url: string) {
	if (url !== BROWSER_RUN_CODE_URL)
		throw new Error("Unexpected browser endpoint");
	const pair = new WebSocketPair();
	pair[1].accept();
	const session = await relay.open(url, new Receiver(pair[1]) as never);
	let outgoing = Promise.resolve();
	pair[1].addEventListener("message", (event) => {
		outgoing = outgoing.then(() => session.send(event.data as string));
		void outgoing.catch(() => {
			try {
				pair[1].close();
			} catch {
				/* Closed. */
			}
		});
	});
	pair[1].addEventListener("close", () => {
		void session.close();
	});
	return new Response(null, { status: 101, webSocket: pair[0] });
}

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
		const binding = {
			fetch: (url: string | URL) => bindingResponse(relay, String(url)),
		};
		const connectOptions = { sessionId: "owned", persistent: true };
		const browser = await connect(binding as never, connectOptions);
		try {
			adoptRunCodeContext(browser, metadata);
			await restoreRunCodeContextState(
				browser.contexts()[0]!,
				metadata.state.context,
			);
			const page = await selectedPage(browser, metadata);
			let json: string;
			try {
				const { default: userCode } = await import("browser-user-code.js");
				if (typeof userCode !== "function")
					throw new Error("Run-code source must be a function");
				json = serializeResult(await userCode(page));
			} catch (error) {
				return {
					ok: false as const,
					message: String(error).slice(0, 4096),
					stateJson: serializeRunCodeState(
						captureRunCodeState(browser, page.context()),
					),
				};
			}
			if (new TextEncoder().encode(json).byteLength > metadata.maxOutputBytes)
				throw new Error("Run-code output limit exceeded");
			return {
				ok: true as const,
				json,
				stateJson: serializeRunCodeState(
					captureRunCodeState(browser, page.context()),
				),
			};
		} finally {
			await browser.close();
		}
	}
}
