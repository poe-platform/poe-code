import type { BrowserContext } from "@cloudflare/playwright";
import { expect } from "vitest";

export function ownedProvider(
	deleteStatus = 200,
	fault?: { stallAt?: number; failAt?: number; deferCloseAt?: number },
) {
	const controller = new AbortController();
	const peers: WebSocket[] = [];
	const upstreams: WebSocket[] = [];
	const requests: string[] = [];
	const clientHeaders: (string | null)[] = [];
	const requestSignals: AbortSignal[] = [];
	const commands: string[][] = [];
	const closes: Promise<void>[] = [];
	const handshake = Promise.withResolvers<void>();
	const binding = {
		fetch: Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const request = new Request(input, init);
				requests.push(request.method);
				if (request.method === "POST")
					return Response.json({ sessionId: "owned-session" });
				if (request.method === "DELETE")
					return new Response(null, { status: deleteStatus });
				expect(new URL(request.url).pathname).toBe(
					"/v1/devtools/browser/owned-session",
				);
				clientHeaders.push(request.headers.get("cf-brapi-client"));
				if (fault?.failAt === peers.length)
					return new Response(null, { status: 502 });
				const pair = new WebSocketPair();
				const peer = pair[1];
				peer.accept();
				requestSignals.push(request.signal);
				request.signal.addEventListener("abort", () => peer.close(), {
					once: true,
				});
				const index = peers.length;
				peers.push(peer);
				upstreams.push(pair[0]);
				commands.push([]);
				closes.push(
					new Promise((resolve) =>
						peer.addEventListener(
							"close",
							() => {
								if (fault?.deferCloseAt !== index) peer.close();
								resolve();
							},
							{ once: true },
						),
					),
				);
				peer.addEventListener("message", (event: MessageEvent<string>) => {
					if (fault?.stallAt === index) {
						handshake.resolve();
						return;
					}
					const command = JSON.parse(event.data);
					commands[index]!.push(command.method);
					peer.send(
						JSON.stringify({
							id: command.id,
							sessionId: command.sessionId,
							result: reply(command.method),
						}),
					);
					if (command.method === "Page.navigate")
						peer.send(
							JSON.stringify({
								method: "Page.loadEventFired",
								sessionId: command.sessionId,
								params: {},
							}),
						);
					if (command.method === "Target.closeTarget") retire(peers);
				});
				return new Response(null, { status: 101, webSocket: pair[0] });
			},
			{ preconnect: fetch.preconnect },
		),
	};
	return {
		binding,
		controller,
		peers,
		upstreams,
		requests,
		commands,
		closes,
		handshake,
		clientHeaders,
		requestSignals,
	};
}

function retire(peers: WebSocket[]) {
	for (const socket of peers) {
		if (socket.readyState === WebSocket.OPEN)
			socket.send(
				JSON.stringify({
					method: "Target.targetDestroyed",
					params: { targetId: "private-target" },
				}),
			);
	}
}

function reply(method: string) {
	switch (method) {
		case "Browser.getVersion":
			return { product: "Chrome/123.0", userAgent: "HeadlessChrome/123.0" };
		case "Target.createTarget":
			return { targetId: "private-target" };
		case "Target.createBrowserContext":
			return { browserContextId: "context" };
		case "Target.attachToTarget":
			return { sessionId: "private-session" };
		case "Target.getTargetInfo":
			return {
				targetInfo: {
					targetId: "private-target",
					type: "browser",
					browserContextId: "context",
				},
			};
		case "Target.closeTarget":
			return { success: true };
		case "Target.getTargets":
			return {
				targetInfos: [
					{ targetId: "private-target", type: "page" },
					{ targetId: "public-target", type: "page" },
				],
			};
		default:
			return {};
	}
}

export function storageContext(context: BrowserContext) {
	return {
		newPage: context.newPage.bind(context),
		pages: context.pages.bind(context),
		close: context.close.bind(context),
		on: context.on.bind(context),
		off: context.off.bind(context),
	};
}
