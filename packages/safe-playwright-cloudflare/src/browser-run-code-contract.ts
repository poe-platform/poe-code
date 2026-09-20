import type {
	Browser,
	BrowserContextOptions,
	Page,
} from "@cloudflare/playwright";
import type { RunCodeHeader } from "./browser-run-code-context-state.js";
import type { RunCodeState } from "./browser-run-code-state.js";

// The native server stores protocol header entries, while the public API accepts a map.
export type RunCodeNativeContextOptions = Omit<
	BrowserContextOptions,
	"extraHTTPHeaders"
> & { extraHTTPHeaders?: RunCodeHeader[] };

export interface BrowserRunCodeInput {
	page: Page;
	source: string;
	signal: AbortSignal;
	timeoutMs: number;
	maxOutputBytes: number;
	maxPages: number;
}

export interface BrowserRunCodeOptions {
	ownerId: string;
	browser: Browser;
	loader: WorkerLoader;
	guestSource: string;
	/** Opens only the browser acquired for this owner; never accepts a guest ID. */
	connectSocket(signal: AbortSignal): Promise<WebSocket>;
	/** Idempotently destroys the owned browser, including renderer-side work. */
	retire(): Promise<void>;
}

export interface BrowserRunCodeMetadata {
	targetId: string;
	contextId: string;
	contextOptions: RunCodeNativeContextOptions;
	state: RunCodeState;
	maxOutputBytes: number;
}

export interface BrowserRunCodeReceiver {
	frame(message: string): Promise<void>;
	close(): Promise<void>;
	dup(): BrowserRunCodeReceiver;
	[Symbol.dispose](): void;
}

export interface BrowserRunCodeTransport {
	send(message: string): void | Promise<void>;
	close(): void | Promise<void>;
}

export interface BrowserRunCodeRelay {
	open(
		url: string,
		receiver: BrowserRunCodeReceiver,
	): Promise<BrowserRunCodeTransport>;
}

export const BROWSER_RUN_CODE_URL =
	"http://fake.host/v1/devtools/browser/owned?persistent=true";
