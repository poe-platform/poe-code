import { RpcTarget } from "cloudflare:workers";
import { waitForBrowserSocketClose } from "./browser-private-transport.js";
import {
	type createRunCodeCreationBudget,
	createRunCodeFrameBudget,
} from "./browser-run-code-budget.js";
import {
	BROWSER_RUN_CODE_URL,
	type BrowserRunCodeReceiver,
} from "./browser-run-code-contract.js";
import {
	closeBrowserSocket,
	registerBrowserSocketClose,
} from "./browser-socket-closure.js";

export function createRunCodeRelay(options: {
	signal: AbortSignal;
	connectSocket(signal: AbortSignal): Promise<WebSocket>;
	creations: ReturnType<typeof createRunCodeCreationBudget>;
	fail(error: unknown): void;
}) {
	const charge = createRunCodeFrameBudget();
	let revoked = false;
	let opening = false;
	let socket: WebSocket | undefined;
	let receiver: BrowserRunCodeReceiver | undefined;
	let incoming = Promise.resolve();
	const admitted = Promise.withResolvers<void>();
	let closing: Promise<void> | undefined;
	const check = () => {
		options.signal.throwIfAborted();
		if (revoked) throw new Error("Run-code browser access revoked");
	};
	async function closeSocket() {
		if (!socket) return;
		const failures: unknown[] = [];
		try {
			closeBrowserSocket(socket);
		} catch (error) {
			failures.push(error);
		}
		try {
			await waitForBrowserSocketClose(socket);
		} catch (error) {
			failures.push(error);
		}
		if (failures.length)
			throw new AggregateError(failures, "Run-code socket cleanup failed");
	}
	async function closeReceiver() {
		if (!receiver) return;
		const retained = receiver;
		receiver = undefined;
		const failures: unknown[] = [];
		try {
			await retained.close();
		} catch (error) {
			failures.push(error);
		}
		try {
			retained[Symbol.dispose]();
		} catch (error) {
			failures.push(error);
		}
		if (failures.length)
			throw new AggregateError(failures, "Run-code receiver cleanup failed");
	}
	function assertCleanup(outcomes: PromiseSettledResult<void>[]) {
		const failures = outcomes
			.filter((outcome) => outcome.status === "rejected")
			.map((outcome) => outcome.reason);
		if (failures.length)
			throw new AggregateError(failures, "Run-code transport cleanup failed");
	}
	const close = () => {
		if (closing) return closing;
		revoked = true;
		closing = (async () => {
			if (opening) await admitted.promise;
			assertCleanup(await Promise.allSettled([closeSocket(), closeReceiver()]));
		})();
		void closing.catch(() => {});
		return closing;
	};
	const fail = (error: unknown) => {
		if (revoked) return;
		void close().catch(options.fail);
		options.fail(error);
	};
	class Session extends RpcTarget {
		send(message: string) {
			try {
				check();
				options.creations.command(charge(message));
				socket!.send(message);
			} catch (error) {
				fail(error);
				throw error;
			}
		}
		close() {
			return close();
		}
	}
	class Relay extends RpcTarget {
		async open(url: string, callback: BrowserRunCodeReceiver) {
			check();
			if (opening || url !== BROWSER_RUN_CODE_URL)
				throw new Error("Run-code may connect only to its owned browser");
			opening = true;
			try {
				receiver = callback.dup();
				socket = await options.connectSocket(options.signal);
				registerBrowserSocketClose(socket);
				check();
				socket.accept();
				socket.addEventListener("message", (event) => {
					try {
						check();
						options.creations.reply(charge(event.data));
						const message = event.data as string;
						incoming = incoming.then(async () => {
							if (revoked) return;
							check();
							await receiver!.frame(message);
						});
						void incoming.catch(fail);
					} catch (error) {
						fail(error);
					}
				});
				socket.addEventListener("close", () => {
					if (!revoked) fail(new Error("Run-code CDP transport closed"));
				});
				socket.addEventListener("error", () => {
					fail(new Error("Run-code CDP transport failed"));
				});
				return new Session();
			} catch (error) {
				fail(error);
				throw error;
			} finally {
				admitted.resolve();
			}
		}
	}
	return { capability: new Relay(), close, opened: () => opening };
}
