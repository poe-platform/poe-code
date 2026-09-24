import { RpcTarget } from "cloudflare:workers";
import {
	BROWSER_RUN_CODE_URL,
	type BrowserRunCodeRelay,
	type BrowserRunCodeTransport,
} from "./browser-run-code-contract.js";

/** Keep the guest connection alive until the relay has drained its admitted RPCs. */
export function createRunCodeBinding(relay: BrowserRunCodeRelay) {
	let session: BrowserRunCodeTransport | undefined;
	let closing: Promise<void> | undefined;
	let revoked = false;
	class Receiver extends RpcTarget {
		#socket: WebSocket;
		constructor(socket: WebSocket) {
			super();
			this.#socket = socket;
		}
		frame(message: string) {
			if (!revoked) this.#socket.send(message);
		}
		close() {
			revoked = true;
			try {
				this.#socket.close();
			} catch {
				/* Already closed. */
			}
		}
	}
	const close = () => {
		revoked = true;
		closing ??= (async () => { await session?.close(); })();
		// A socket event may start shutdown before the guest joins it below.
		void closing.catch(() => {});
		return closing;
	};
	return {
		async fetch(url: string | URL) {
			if (String(url) !== BROWSER_RUN_CODE_URL)
				throw new Error("Unexpected browser endpoint");
			const pair = new WebSocketPair();
			pair[1].accept();
			const opened = await relay.open(BROWSER_RUN_CODE_URL, new Receiver(pair[1]) as never);
			session = opened;
			let outgoing = Promise.resolve();
			pair[1].addEventListener("message", (event) => {
				outgoing = outgoing.then(() => {
					if (!revoked) return opened.send(event.data as string);
				});
				void outgoing.catch(() => {
					try {
						pair[1].close();
					} catch {
						/* Closed. */
					}
				});
			});
			pair[1].addEventListener("close", () => { void close(); });
			return new Response(null, { status: 101, webSocket: pair[0] });
		},
		revoke() { revoked = true; },
		close,
	};
}
