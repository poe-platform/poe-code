import type { Page } from "@cloudflare/playwright";
import { EventEmitter } from "node:events";
import { expect, test } from "vitest";
import { createBrowserSnapshotScheduler } from "../src/browser-snapshot-scheduler";

interface Progress { signal: AbortSignal }
interface SnapshotOptions { timeout?: number; track?: string }
interface NativeFrame {
	name: string;
	detached: boolean;
	isDetached(): boolean;
	selected: boolean;
	children: NativeFrame[];
	sentinel: symbol;
	retryWithProgressAndTimeouts<T>(progress: Progress, timeouts: number[], action: (sentinel: symbol) => Promise<T>): Promise<T>;
}
type SnapshotAction = (frame: NativeFrame, progress: Progress, options: SnapshotOptions, sentinel: symbol) => Promise<string | symbol>;

function browserPage(action: SnapshotAction = async frame => frame.name) {
	const frames: NativeFrame[] = [];
	const listeners = new Map<string, Set<(frame: NativeFrame) => void>>();
	const retries: { receiver: NativeFrame; progress: Progress; timeouts: number[] }[] = [];
	const snapshots: { receiver: unknown; progress: Progress; options: SnapshotOptions }[] = [];
	const retryTimeouts = [1000, 2000, 4000, 8000];
	function addFrame(parent: NativeFrame | undefined, name: string, selected = true) {
		const frame: NativeFrame = {
			name, selected, detached: false, isDetached() { return this.detached; }, children: [], sentinel: Symbol(name),
			async retryWithProgressAndTimeouts(progress, timeouts, callback) {
				retries.push({ receiver: this, progress, timeouts });
				for (;;) {
					const value = await callback(this.sentinel);
					if (value !== this.sentinel) return value;
				}
			},
		};
		frames.push(frame);
		parent?.children.push(frame);
		for (const listener of listeners.get("frameattached") ?? []) listener(frame);
		return frame;
	}
	const root = addFrame(undefined, "root");
	const native = {
		frames: () => [...frames],
		on(event: string, listener: (frame: NativeFrame) => void) {
			let group = listeners.get(event);
			if (!group) listeners.set(event, group = new Set());
			group.add(listener);
		},
		off(event: string, listener: (frame: NativeFrame) => void) {
			listeners.get(event)?.delete(listener);
		},
		async snapshotForAI(progress: Progress, options: SnapshotOptions = {}) {
			snapshots.push({ receiver: this, progress, options });
			const visit = async (frame: NativeFrame): Promise<string[]> => {
				const value = await frame.retryWithProgressAndTimeouts(progress, retryTimeouts,
					async sentinel => action(frame, progress, options, sentinel));
				if (typeof value !== "string") throw new Error("Unexpected native snapshot result");
				// Match the provider: recurse only after the current frame callback returns.
				const children = await Promise.all(frame.children.filter(child => child.selected).map(visit));
				return [value, ...children.flat()];
			};
			return { full: (await visit(root)).join("\n"), incremental: options.track };
		},
	};
	const page = { _connection: { toImpl: () => native } } as unknown as Page;
	return { page, native, root, addFrame, retries, retryTimeouts, snapshots,
		detach(frame: NativeFrame) {
			frame.detached = true;
			for (const listener of listeners.get("framedetached") ?? []) listener(frame);
		},
	};
}

function progress() { return { signal: new AbortController().signal }; }
function nextTurn() { return new Promise<void>(resolve => setTimeout(resolve, 0)); }
function observe<T>(operation: Promise<T>) {
	const result: { status: "pending" | "fulfilled" | "rejected"; value?: T; reason?: unknown } = { status: "pending" };
	const done = operation.then(
		value => { result.status = "fulfilled"; result.value = value; },
		reason => { result.status = "rejected"; result.reason = reason; },
	);
	return { result, done };
}

test("a late page event after owner shutdown performs no native preparation", () => {
	const scheduler = createBrowserSnapshotScheduler();
	const context = new EventEmitter();
	context.on("page", scheduler.prepare);
	const fixture = browserPage();
	const snapshot = fixture.native.snapshotForAI;
	const retry = fixture.root.retryWithProgressAndTimeouts;
	scheduler.stop(new Error("browser disconnected"));
	expect(() => context.emit("page", fixture.page)).not.toThrow();
	expect(fixture.native.snapshotForAI).toBe(snapshot);
	expect(fixture.root.retryWithProgressAndTimeouts).toBe(retry);
});

test("detaching a queued native frame rejects it before any snapshot callback runs", async () => {
	const scheduler = createBrowserSnapshotScheduler();
	const hold = Promise.withResolvers<void>();
	const entered: string[] = [];
	const first = browserPage(async () => { entered.push("active"); await hold.promise; return "active"; });
	const second = browserPage(async () => { entered.push("detached"); return "detached"; });
	scheduler.prepare(first.page);
	scheduler.prepare(second.page);
	const active = observe(first.native.snapshotForAI(progress()));
	const waiting = observe(second.native.snapshotForAI(progress()));
	try {
		await nextTurn();
		second.detach(second.root);
		await nextTurn();
		expect(waiting.result).toMatchObject({ status: "rejected", reason: new Error("Frame was detached") });
		expect(active.result.status).toBe("pending");
		expect(entered).toEqual(["active"]);
	} finally {
		hold.resolve();
		await Promise.all([active.done, waiting.done]);
		scheduler.stop(new Error("test finished"));
		await scheduler.settled();
	}
	expect(entered).toEqual(["active"]);
});

test("registered snapshots serialize callbacks and preserve native arguments, sentinels and results", async () => {
	const scheduler = createBrowserSnapshotScheduler();
	const hold = Promise.withResolvers<void>();
	const firstProgress = progress(), secondProgress = progress();
	const firstOptions = { timeout: 5000, track: "first" }, secondOptions = { timeout: 9000, track: "second" };
	const entered: Progress[] = [];
	let firstAttempts = 0;
	const fixture = browserPage(async (frame, current, options, sentinel) => {
		entered.push(current);
		expect(sentinel).toBe(frame.sentinel);
		if (current === firstProgress && firstAttempts++ === 0) {
			await hold.promise;
			return sentinel;
		}
		return `${frame.name}:${options.track}`;
	});
	scheduler.prepare(fixture.page);
	const first = observe(fixture.native.snapshotForAI(firstProgress, firstOptions));
	const second = observe(fixture.native.snapshotForAI(secondProgress, secondOptions));
	try {
		await nextTurn();
		expect(entered).toEqual([firstProgress]);
	} finally {
		hold.resolve();
		await Promise.all([first.done, second.done]);
		scheduler.stop(new Error("test finished"));
		await scheduler.settled();
	}
	expect(first.result).toMatchObject({ status: "fulfilled", value: { full: "root:first", incremental: "first" } });
	expect(second.result).toMatchObject({ status: "fulfilled", value: { full: "root:second", incremental: "second" } });
	expect(firstAttempts).toBe(2);
	expect(fixture.snapshots.map(call => call.receiver)).toEqual([fixture.native, fixture.native]);
	expect(fixture.snapshots[0]?.options).toBe(firstOptions);
	expect(fixture.snapshots[1]?.options).toBe(secondOptions);
	for (const call of fixture.retries) {
		expect(call.receiver).toBe(fixture.root);
		expect(call.timeouts).toBe(fixture.retryTimeouts);
	}
});

test("native selection traverses existing, future and nested frames without eager hidden-frame work", async () => {
	const scheduler = createBrowserSnapshotScheduler();
	const hold = Promise.withResolvers<void>();
	const entered: string[] = [];
	const fixture = browserPage(async frame => {
		entered.push(frame.name);
		if (frame.name === "existing") await hold.promise;
		return frame.name;
	});
	fixture.addFrame(fixture.root, "existing");
	fixture.addFrame(fixture.root, "hidden", false);
	scheduler.prepare(fixture.page);
	scheduler.prepare(fixture.page);
	const future = fixture.addFrame(fixture.root, "future");
	fixture.addFrame(future, "nested");
	const operation = observe(fixture.native.snapshotForAI(progress()));
	try {
		await nextTurn();
		expect(entered).toEqual(["root", "existing"]);
	} finally {
		hold.resolve();
		await operation.done;
		scheduler.stop(new Error("test finished"));
		await scheduler.settled();
	}
	expect(operation.result).toMatchObject({ status: "fulfilled", value: { full: "root\nexisting\nfuture\nnested" } });
	expect(entered).toEqual(["root", "existing", "future", "nested"]);
});

test("unregistered progress bypasses an occupied snapshot gate", async () => {
	const scheduler = createBrowserSnapshotScheduler();
	const hold = Promise.withResolvers<void>();
	const fixture = browserPage(async frame => { await hold.promise; return frame.name; });
	scheduler.prepare(fixture.page);
	const snapshot = observe(fixture.native.snapshotForAI(progress()));
	const outsideProgress = progress();
	const outsideTimeouts = [17];
	const value = { untouched: true };
	const outside = observe(fixture.root.retryWithProgressAndTimeouts(outsideProgress, outsideTimeouts, async sentinel => {
		expect(sentinel).toBe(fixture.root.sentinel);
		return value;
	}));
	try {
		await nextTurn();
		expect(snapshot.result.status).toBe("pending");
		expect(outside.result.status).toBe("fulfilled");
		expect(outside.result.value).toBe(value);
		const call = fixture.retries.find(entry => entry.progress === outsideProgress);
		expect(call?.receiver).toBe(fixture.root);
		expect(call?.timeouts).toBe(outsideTimeouts);
	} finally {
		hold.resolve();
		await Promise.all([snapshot.done, outside.done]);
		scheduler.stop(new Error("test finished"));
		await scheduler.settled();
	}
});

test("canceling queued snapshot progress rejects its exact reason before any callback runs", async () => {
	const scheduler = createBrowserSnapshotScheduler();
	const hold = Promise.withResolvers<void>();
	const firstProgress = progress();
	const canceled = new AbortController();
	const secondProgress = { signal: canceled.signal };
	const reason = { canceled: "source timeout" };
	const entered: Progress[] = [];
	const fixture = browserPage(async (frame, current) => {
		entered.push(current);
		if (current === firstProgress) await hold.promise;
		return frame.name;
	});
	scheduler.prepare(fixture.page);
	const first = observe(fixture.native.snapshotForAI(firstProgress));
	const second = observe(fixture.native.snapshotForAI(secondProgress));
	try {
		await nextTurn();
		canceled.abort(reason);
		await nextTurn();
		expect(second.result.status).toBe("rejected");
		expect(second.result.reason).toBe(reason);
		expect(entered).toEqual([firstProgress]);
	} finally {
		hold.resolve();
		await Promise.all([first.done, second.done]);
		scheduler.stop(new Error("test finished"));
		await scheduler.settled();
	}
	expect(entered).toEqual([firstProgress]);
});

test("stop rejects queued and new work while settled waits for the admitted callback", async () => {
	const scheduler = createBrowserSnapshotScheduler();
	const hold = Promise.withResolvers<void>();
	const entered: Progress[] = [];
	const fixture = browserPage(async (frame, current) => {
		entered.push(current);
		await hold.promise;
		return frame.name;
	});
	scheduler.prepare(fixture.page);
	const firstProgress = progress();
	const first = observe(fixture.native.snapshotForAI(firstProgress));
	const second = observe(fixture.native.snapshotForAI(progress()));
	let third: ReturnType<typeof observe> | undefined;
	const reason = new Error("owned browser interrupted");
	try {
		await nextTurn();
		scheduler.stop(reason);
		third = observe(fixture.native.snapshotForAI(progress()));
		const drained = observe(scheduler.settled());
		await nextTurn();
		expect(second.result.status).toBe("rejected");
		expect(second.result.reason).toBe(reason);
		expect(third.result.status).toBe("rejected");
		expect(third.result.reason).toBe(reason);
		expect(drained.result.status).toBe("pending");
		expect(entered).toEqual([firstProgress]);
	} finally {
		hold.resolve();
		await Promise.all([first.done, second.done, third?.done]);
		scheduler.stop(reason);
		await scheduler.settled();
	}
	expect(first.result.status).toBe("fulfilled");
});

test("a native callback failure preserves its identity and frees queued snapshot work", async () => {
	const scheduler = createBrowserSnapshotScheduler();
	const hold = Promise.withResolvers<void>();
	const firstProgress = progress();
	const failure = new Error("native context destroyed");
	const fixture = browserPage(async (frame, current) => {
		if (current === firstProgress) { await hold.promise; throw failure; }
		return frame.name;
	});
	scheduler.prepare(fixture.page);
	const first = observe(fixture.native.snapshotForAI(firstProgress));
	const second = observe(fixture.native.snapshotForAI(progress()));
	try {
		await nextTurn();
		expect(second.result.status).toBe("pending");
	} finally {
		hold.resolve();
		await Promise.all([first.done, second.done]);
		scheduler.stop(new Error("test finished"));
		await scheduler.settled();
	}
	expect(first.result.status).toBe("rejected");
	expect(first.result.reason).toBe(failure);
	expect(second.result).toMatchObject({ status: "fulfilled", value: { full: "root" } });
});

test("pages prepared by the same owner share admission capacity", async () => {
	const scheduler = createBrowserSnapshotScheduler();
	const hold = Promise.withResolvers<void>();
	const entered: string[] = [];
	const firstPage = browserPage(async frame => { entered.push("first"); await hold.promise; return frame.name; });
	const secondPage = browserPage(async frame => { entered.push("second"); return frame.name; });
	scheduler.prepare(firstPage.page);
	scheduler.prepare(secondPage.page);
	const first = observe(firstPage.native.snapshotForAI(progress()));
	const second = observe(secondPage.native.snapshotForAI(progress()));
	try {
		await nextTurn();
		expect(entered).toEqual(["first"]);
	} finally {
		hold.resolve();
		await Promise.all([first.done, second.done]);
		scheduler.stop(new Error("test finished"));
		await scheduler.settled();
	}
	expect(entered).toEqual(["first", "second"]);
	expect(first.result.status).toBe("fulfilled");
	expect(second.result.status).toBe("fulfilled");
});
