import assert from "node:assert/strict";
import type { BrowserWorker } from "@cloudflare/playwright";
import { registerBrowserSocketClose } from "../src/browser-socket-closure";
import { waitForBrowserSocketClose } from "../src/browser-private-transport";
import type {
	Fixture,
	Origins,
} from "./browser-storage-admission.test.worker-cases";
import {
	assertCommandFailure,
	failureText,
} from "./browser-storage-admission.test.worker-controls";
import { seed } from "./browser-storage-admission.test.worker-records";

type Reply = {
	id?: number;
	result?: { success?: boolean; targetId?: string };
	method?: string;
	params?: { targetId?: string };
};

class ControlRelay {
	private restoreProbe: ((expression: string) => string) | undefined;
	private restoreStart = Promise.withResolvers<void>();
	get restoreStarted() { return this.restoreStart.promise; }
	private probeFrame: { sessionId?: string; params: Record<string, unknown> } | undefined;
	private probeSocket: WebSocket | undefined;
	private probeId = -1;
	private probes = new Map<number, ReturnType<typeof Promise.withResolvers<unknown>>>();
	interceptRestore(transform: (expression: string) => string) {
		this.restoreProbe = transform;
	}
	async inspectRestore(expression: string) {
		assert.ok(this.probeFrame && this.probeSocket);
		const id = this.probeId--;
		const result = Promise.withResolvers<unknown>();
		this.probes.set(id, result);
		this.probeSocket.send(JSON.stringify({ id, method: "Runtime.evaluate", sessionId: this.probeFrame.sessionId,
			params: { ...this.probeFrame.params, expression, awaitPromise: true, returnByValue: true } }));
		return result.promise;
	}
	private intercepted = false;
	private holdingNavigation = false;
	private heldNavigationId: number | undefined;
	private heldNavigation: { client: WebSocket; frame: string } | undefined;
	private navigation = Promise.withResolvers<void>();
	private started = performance.now();
	private timings = new Map<number, { method: string; started: number }>();
	holdNextNavigation() {
		this.holdingNavigation = true;
		this.navigation = Promise.withResolvers<void>();
	}
	get navigationHeld() {
		return this.navigation.promise;
	}
	resumeNavigation() {
		assert.ok(this.heldNavigation);
		this.heldNavigation.client.send(this.heldNavigation.frame);
		this.heldNavigation = undefined;
	}
	private failingClose = false;
	private holdingEvaluation = false;
	private held: { client: WebSocket; frame: string } | undefined;
	private heldCommand: number | undefined;
	private creations = new Set<number>();
	private activeTargets = new Set<string>();
	private pendingClose = new Map<number, string>();
	private failedReply:
		| { client: WebSocket; targetId: string; frame: string }
		| undefined;
	private closes = new Set<number>();
	private evaluation = Promise.withResolvers<void>();
	private retiringEOF = false;
	private eofCommands = new Map<number, string>();
	private suppressedTargets = new Set<string>();
	private withheldDestruction = new Set<string>();
	private eofReply:
		| {
				client: WebSocket;
				upstream: WebSocket;
				frame: string;
				targetId: string;
		  }
		| undefined;
	private rawClosed: Promise<void> | undefined;
	private rawSockets: WebSocket[] = [];
	private sessionURL: string | undefined;
	closeResponses = 0;
	injectedResponses = 0;
	get activeTargetCount() {
		return this.activeTargets.size;
	}
	destroyedTargets = 0;
	suppressedDestructions = 0;
	forwardedEOFReplies = 0;
	ownerDeletes = 0;

	async connect(
		native: BrowserWorker,
		input: RequestInfo | URL,
		init?: RequestInit,
	) {
		const response = await native.fetch(input, init);
		this.recordDeletion(input, init, response);
		if (response.webSocket) {
			this.rawSockets.push(response.webSocket);
			registerBrowserSocketClose(response.webSocket);
		}
		if (!response.webSocket || this.intercepted) return response;
		this.intercepted = true;
		this.sessionURL = input instanceof Request ? input.url : String(input);
		const upstream = response.webSocket;
		upstream.accept();
		const pair = new WebSocketPair();
		registerBrowserSocketClose(upstream, pair[0]);
		this.rawClosed = waitForBrowserSocketClose(upstream);
		const client = pair[1];
		client.accept();
		client.addEventListener("message", (event) => {
			assert.equal(typeof event.data, "string");
			const frame = JSON.parse(event.data);
			this.trackCommand(frame);
			if (this.restoreProbe && frame.method === "Runtime.evaluate" && frame.params?.expression?.includes("async function restoreStorageOrigin(")) {
				this.probeFrame = frame;
				this.probeSocket = upstream;
				frame.params.expression = this.restoreProbe(frame.params.expression);
				this.restoreProbe = undefined;
				this.restoreStart.resolve();
			}
			upstream.send(JSON.stringify(frame));
		});
		upstream.addEventListener("message", (event) => {
			assert.equal(typeof event.data, "string");
			const frame = JSON.parse(event.data);
			const probe = this.probes.get(frame.id);
			if (probe) {
				this.probes.delete(frame.id);
				if (frame.error || frame.result?.exceptionDetails) probe.reject(new Error(JSON.stringify(frame)));
				else probe.resolve(frame.result?.result?.value);
				return;
			}
			this.deliver(client, upstream, event.data);
		});
		client.addEventListener("close", () => upstream.close());
		upstream.addEventListener("close", () => client.close());
		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	private recordDeletion(
		input: RequestInfo | URL,
		init: RequestInit | undefined,
		response: Response,
	) {
		const url = input instanceof Request ? input.url : String(input);
		const method =
			init?.method ?? (input instanceof Request ? input.method : "GET");
		if (method === "DELETE" && url === this.sessionURL) {
			assert.ok(
				response.ok,
				"Owned session DELETE must succeed against native binding",
			);
			this.ownerDeletes++;
		}
	}

	private trackCommand(frame: {
		id: number;
		method: string;
		params?: { targetId?: string };
	}) {
		this.timings.set(frame.id, {
			method: frame.method,
			started: performance.now(),
		});
		if (this.holdingNavigation && frame.method === "Page.navigate") {
			this.holdingNavigation = false;
			this.heldNavigationId = frame.id;
		}
		if (frame.method === "Target.createTarget") this.creations.add(frame.id);
		if (frame.method === "Target.closeTarget") {
			this.trackClose(frame);
		}
		if (this.holdingEvaluation && frame.method === "Runtime.evaluate") {
			this.holdingEvaluation = false;
			this.heldCommand = frame.id;
		}
	}

	private trackClose(frame: { id: number; params?: { targetId?: string } }) {
		this.closes.add(frame.id);
		if (this.failingClose) {
			assert.ok(frame.params?.targetId);
			assert.ok(this.activeTargets.has(frame.params.targetId));
			this.pendingClose.set(frame.id, frame.params.targetId);
			this.failingClose = false;
		}
		if (!this.retiringEOF) return;
		assert.ok(frame.params?.targetId);
		this.eofCommands.set(frame.id, frame.params.targetId);
		this.suppressedTargets.add(frame.params.targetId);
	}

	private recordNativeTargets(frame: Reply) {
		if (
			frame.id !== undefined &&
			this.creations.delete(frame.id) &&
			frame.result?.targetId
		)
			this.activeTargets.add(frame.result.targetId);
		if (
			frame.method === "Target.targetDestroyed" &&
			frame.params?.targetId &&
			this.activeTargets.delete(frame.params.targetId)
		)
			this.destroyedTargets++;
		if (
			frame.id !== undefined &&
			this.closes.delete(frame.id) &&
			frame.result?.success === true
		)
			this.closeResponses++;
	}

	private deliver(client: WebSocket, upstream: WebSocket, data: string) {
		const frame: Reply = JSON.parse(data);
		this.recordNativeTargets(frame);
		if (frame.id !== undefined) {
			const timing = this.timings.get(frame.id);
			if (
				timing &&
				[
					"Target.createTarget",
					"Target.closeTarget",
					"Fetch.fulfillRequest",
					"Page.navigate",
				].includes(timing.method)
			)
				console.log(
					JSON.stringify({
						diagnostic: "storage-checkpoint-timing",
						method: timing.method,
						elapsedMs: performance.now() - timing.started,
						atMs: performance.now() - this.started,
						withheld: frame.id === this.heldNavigationId,
					}),
				);
			this.timings.delete(frame.id);
		}
		if (
			frame.method === "Fetch.requestPaused" ||
			frame.method === "Page.loadEventFired"
		)
			console.log(
				JSON.stringify({
					diagnostic: "storage-checkpoint-event",
					method: frame.method,
					elapsedMs: performance.now() - this.started,
				}),
			);
		if (frame.id !== undefined && frame.id === this.heldNavigationId) {
			this.heldNavigationId = undefined;
			this.heldNavigation = { client, frame: data };
			this.navigation.resolve();
			return;
		}
		if (this.holdForEOF(client, upstream, frame, data)) return;
		if (frame.id !== undefined && frame.id === this.heldCommand) {
			this.heldCommand = undefined;
			this.held = { client, frame: data };
			this.evaluation.resolve();
			return;
		}
		const targetId =
			frame.id === undefined ? undefined : this.pendingClose.get(frame.id);
		if (targetId) {
			this.pendingClose.delete(frame.id!);
			assert.equal(
				frame.result?.success,
				true,
				"Fault only follows an acknowledged actual Chromium close",
			);
			this.failedReply = {
				client,
				targetId,
				frame: JSON.stringify({
					id: frame.id,
					error: {
						code: -32000,
						message: "storage-admission-injected-close-failure",
					},
				}),
			};
		} else client.send(data);
		this.flushCloseFailure();
	}

	private flushCloseFailure() {
		const reply = this.failedReply;
		if (!reply || this.activeTargets.has(reply.targetId)) return;
		this.failedReply = undefined;
		this.injectedResponses++;
		reply.client.send(reply.frame);
	}

	private holdForEOF(
		client: WebSocket,
		upstream: WebSocket,
		frame: Reply,
		data: string,
	) {
		if (
			frame.method === "Target.targetDestroyed" &&
			frame.params?.targetId &&
			this.suppressedTargets.has(frame.params.targetId)
		) {
			this.withheldDestruction.add(frame.params.targetId);
			this.suppressedDestructions++;
			this.flushEOF();
			return true;
		}
		const targetId =
			frame.id === undefined ? undefined : this.eofCommands.get(frame.id);
		if (!targetId) return false;
		assert.equal(
			frame.result?.success,
			true,
			"EOF only follows actual native target close success",
		);
		this.eofCommands.delete(frame.id!);
		this.eofReply = { client, upstream, frame: data, targetId };
		this.flushEOF();
		return true;
	}

	private flushEOF() {
		const reply = this.eofReply;
		if (!reply || !this.withheldDestruction.has(reply.targetId)) return;
		this.eofReply = undefined;
		reply.client.send(reply.frame);
		this.forwardedEOFReplies++;
		reply.upstream.close(1000, "storage-admission-native-control-eof");
		reply.client.close(1000, "storage-admission-native-control-eof");
	}

	retireWithoutConfirmation() {
		this.retiringEOF = true;
	}

	get rawCloseObserved() {
		assert.ok(this.rawClosed);
		return this.rawClosed;
	}

	async assertNativeRetirement() {
		assert.equal(
			this.rawSockets.length,
			2,
			"Control and primary must both be actual native sockets",
		);
		const outcomes = await Promise.allSettled(
			this.rawSockets.map(waitForBrowserSocketClose),
		);
		for (const outcome of outcomes) assert.equal(outcome.status, "fulfilled");
		for (const socket of this.rawSockets)
			assert.equal(socket.readyState, WebSocket.CLOSED);
		assert.equal(
			this.ownerDeletes,
			1,
			"Exactly the acquired owner session must be deleted",
		);
	}

	failClose() {
		this.failingClose = true;
	}
	holdNextEvaluation() {
		this.holdingEvaluation = true;
	}
	get evaluationHeld() {
		return this.evaluation.promise;
	}
	resumeEvaluation() {
		assert.ok(this.held);
		this.held.client.send(this.held.frame);
		this.held = undefined;
	}
}

export function controlFaultBinding(native: BrowserWorker) {
	const relay = new ControlRelay();
	const binding: BrowserWorker = {
		fetch: Object.assign(relay.connect.bind(relay, native), {
			preconnect: native.fetch.preconnect,
		}),
	};
	return Object.assign(relay, { binding });
}

export function assertFaultDisposal(
	outcome: PromiseSettledResult<void>,
	fault: string,
) {
	const expected: Record<
		string,
		| { status: "fulfilled" }
		| { status: "rejected"; name: string; message: string }
	> = {
		reader: { status: "fulfilled" },
		"profile-limit": { status: "fulfilled" },
		"reader-limit": { status: "fulfilled" },
		cancel: { status: "fulfilled" },
		"public-reader-limit": {
			status: "rejected",
			name: "PlaywrightResourceLimitError",
			message: "Browser storage state byte limit exceeded",
		},
	};
	const failure = expected[fault];
	assert.ok(failure, "Every fault needs an explicit disposal expectation");
	if (failure.status === "fulfilled") {
		assert.equal(outcome.status, "fulfilled", fault);
		return;
	}
	assert.equal(
		outcome.status,
		"rejected",
		`${fault} retains the intentionally oversized native state`,
	);
	if (outcome.status !== "rejected") return;
	assert.ok(outcome.reason instanceof AggregateError);
	assert.equal(outcome.reason.message, "Playwright disposal failed");
	const pending: unknown[] = [outcome.reason];
	const errors: unknown[] = [];
	for (let inspected = 0; pending.length && inspected < 16; inspected++) {
		const error = pending.shift();
		if (error instanceof AggregateError)
			pending.push(...error.errors.slice(0, 16));
		else errors.push(error);
	}
	assert.equal(
		pending.length,
		0,
		"Checkpoint error aggregation must remain bounded",
	);
	assert.equal(
		errors.length,
		1,
		"No unrelated cleanup error may accompany the expected checkpoint failure",
	);
	assert.ok(errors[0] instanceof Error);
	assert.equal(errors[0].name, failure.name, fault);
	assert.equal(errors[0].message, failure.message, fault);
}

export async function checkpointControlEOF(
	create: (owner: string, binding: BrowserWorker) => Fixture,
	native: BrowserWorker,
	input: Origins,
) {
	const control = controlFaultBinding(native);
	const f = create("checkpoint-control-eof", control.binding);
	try {
		assert.equal((await f.run(["open", input.origin, "--json"])).exitCode, 0);
		const session = f.client.inspectSessions()[0]!;
		assert.ok(session.selectedPage);
		await seed(session.selectedPage, "committed");
		assert.equal(
			(await f.run(["eval", "() => undefined", "--json"])).exitCode,
			0,
		);
		const previous = await f.profiles.load(session.name);
		assert.ok(previous);
		const before = control.destroyedTargets;
		control.retireWithoutConfirmation();
		const signal = new AbortController().signal;
		const [outcome] = await Promise.allSettled([
			f.run(["eval", "() => undefined", "--json"], signal),
		]);
		assertCommandFailure(outcome, /storage control disconnected/);
		assert.equal(signal.aborted, false);
		assert.ok(control.destroyedTargets > before);
		assert.equal(control.suppressedDestructions, 1);
		assert.equal(control.forwardedEOFReplies, 1);
		assert.equal(control.injectedResponses, 0);
		assert.deepEqual(await f.profiles.load(session.name), previous);
		const [disposed] = await Promise.allSettled([f.client.dispose()]);
		if (disposed.status === "rejected")
			assert.match(failureText(disposed.reason), /disconnected|detached/);
		await control.rawCloseObserved;
		assert.equal(control.ownerDeletes, 1);
		assert.deepEqual(await f.profiles.load(session.name), previous);
	} finally {
		await Promise.allSettled([f.client.dispose()]);
	}
}
