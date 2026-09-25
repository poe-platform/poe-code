import type { PlaywrightSnapshotJSONCapture } from "@poe-platform/safe-bash/playwright";
import {
	type SnapshotNode,
	type NativeSnapshotResult,
	serializeNativeSnapshot,
} from "./browser-snapshot-json-injected.js";

interface NativeFrame {
	_utilityContext(): Promise<{
		injectedScript(): Promise<{
			evaluate(
				fn: typeof serializeNativeSnapshot,
				options: { boxes: boolean },
			): Promise<ReturnType<typeof serializeNativeSnapshot>>;
		}>;
	}>;
	selectors: {
		resolveFrameForSelector(
			selector: string,
			options: { strict: boolean },
		): Promise<{ frame: NativeFrame } | null>;
	};
}
interface NativeSnapshotPage {
	_snapshotForAI(options: { timeout: number }): Promise<{ full: string }>;
	_connection: {
		toImpl(page: NativeSnapshotPage): { mainFrame(): NativeFrame };
	};
}

// The pinned provider's native tree owns accessibility semantics and usable refs.
// Newer engine-only fields (invalid/ariaHidden) are not invented here.
// Resource refusals finish capture and preserve the healthy lease. Other
// failures, including timeout, still retire potentially in-flight captures.
export const captureBrowserSnapshotJSON: PlaywrightSnapshotJSONCapture = async (
	page,
	options,
) => {
	const native = page as typeof page & NativeSnapshotPage;
	const signal = options.timeoutMs === 0 ? options.signal : AbortSignal.any([
		options.signal,
		AbortSignal.timeout(options.timeoutMs),
	]);
	signal.throwIfAborted();
	let onAbort: () => void = () => {};
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([
			capture(native, { ...options, signal }),
			aborted,
		]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
};

async function capture(
	page: NativeSnapshotPage,
	options: Parameters<PlaywrightSnapshotJSONCapture>[1],
) {
	await page._snapshotForAI({ timeout: options.timeoutMs });
	options.signal.throwIfAborted();
	const root = page._connection.toImpl(page).mainFrame();
	const forest: SnapshotNode[] = [];
	const pending = [{ frame: root, target: forest }];
	for (let index = 0; index < pending.length; index++) {
		options.signal.throwIfAborted();
		const entry = pending[index];
		if (!entry) continue;
		const context = await entry.frame._utilityContext();
		const injected = await context.injectedScript();
		const serialized = await injected.evaluate(serializeNativeSnapshot, {
			boxes: options.boxes ?? false,
		});
		const result = JSON.parse(serialized) as NativeSnapshotResult;
		for (const node of result.nodes) entry.target.push(node);
		const byRef = indexNodes(result.nodes);
		const children = await Promise.all(
			result.iframeRefs.map(async (ref) => {
				options.signal.throwIfAborted();
				const target = byRef.get(ref);
				if (!target) return;
				const resolved = await entry.frame.selectors.resolveFrameForSelector(
					`aria-ref=${ref} >> internal:control=enter-frame >> body`,
					{ strict: true },
				);
				if (!resolved) return;
				target.children ??= [];
				return { frame: resolved.frame, target: target.children as SnapshotNode[] };
			}),
		);
		for (const child of children) if (child) pending.push(child);
	}
	return forest;
}

/** Index native references in O(nodes). */
function indexNodes(nodes: SnapshotNode[]) {
	const byRef = new Map<string, SnapshotNode>();
	const pending: (SnapshotNode | string)[] = [...nodes];
	for (let index = 0; index < pending.length; index++) {
		const node = pending[index];
		if (!node || typeof node === "string") continue;
		if (node.ref) byRef.set(node.ref, node);
		if (node.children) for (const child of node.children) pending.push(child);
	}
	return byRef;
}
