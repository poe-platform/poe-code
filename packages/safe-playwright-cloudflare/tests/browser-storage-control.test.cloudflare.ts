import { expect, test } from "vitest";
import { waitForBrowserSocketClose } from "../src/browser-private-transport";
import { createBrowserStorageControl } from "../src/browser-storage-control";
import { waitForOwnedBrowserSocketClose } from "../src/browser-storage-runtime";

function receive(socket: WebSocket) {
	return new Promise<{ id: number; method: string }>((resolve, reject) => {
		socket.addEventListener(
			"message",
			(event) => {
				const value: unknown = JSON.parse(String(event.data));
				if (
					typeof value !== "object" ||
					value === null ||
					!("id" in value) ||
					typeof value.id !== "number" ||
					!("method" in value) ||
					typeof value.method !== "string"
				)
					return reject(new Error("Invalid outgoing CDP command"));
				resolve({ id: value.id, method: value.method });
			},
			{ once: true },
		);
	});
}

test("a timed-out evaluation preserves cleanup and ignores its late reply", async () => {
	expect(waitForOwnedBrowserSocketClose).toBe(waitForBrowserSocketClose);
	const pair = new WebSocketPair();
	pair[1].accept();
	const owned = createBrowserStorageControl({
		socket: pair[0],
		limits: { commandTimeoutMs: 1 },
	});
	try {
		const incomingEvaluation = receive(pair[1]);
		const evaluation = owned.send("Runtime.evaluate", {
			expression: "Promise.resolve(1)",
			awaitPromise: true,
		});
		const result = evaluation.catch((error: unknown) => error);
		const evaluated = await incomingEvaluation;
		expect(await result).toBeInstanceOf(Error);
		expect(String(await result)).toContain("timed out: Runtime.evaluate");
		pair[1].send(
			JSON.stringify({ id: evaluated.id, result: { value: "late" } }),
		);
		const incomingCleanup = receive(pair[1]);
		const cleanup = owned.send("Target.closeTarget", {
			targetId: "private-storage",
		});
		const closing = await incomingCleanup;
		expect(closing.method).toBe("Target.closeTarget");
		pair[1].send(JSON.stringify({ id: closing.id, result: { success: true } }));
		expect(await cleanup).toEqual({ success: true });
	} finally {
		try {
			await owned.close();
		} finally {
			pair[1].close();
		}
	}
});

test("a creation timeout retires control when its target identity is unknown", async () => {
	const pair = new WebSocketPair();
	pair[1].accept();
	const owned = createBrowserStorageControl({
		socket: pair[0],
		limits: { commandTimeoutMs: 1 },
	});
	try {
		const incomingCreation = receive(pair[1]);
		const creation = owned.send("Target.createTarget", {
			url: "about:blank",
		});
		const result = creation.catch((error: unknown) => error);
		await incomingCreation;
		expect(String(await result)).toContain("timed out: Target.createTarget");
		await expect(owned.send("Target.getTargets")).rejects.toThrow(
			"timed out: Target.createTarget",
		);
	} finally {
		try {
			await expect(owned.close()).rejects.toThrow("cleanup failed");
		} finally {
			pair[1].close();
		}
	}
});
