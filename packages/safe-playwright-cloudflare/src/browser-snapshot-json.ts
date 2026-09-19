import type { PlaywrightSnapshotJSONCapture } from "@poe-platform/safe-bash/playwright";
import {
	type SnapshotNode,
	serializeNativeSnapshot,
} from "./browser-snapshot-json-injected.js";

const MAX_SNAPSHOT_FRAMES = 128;

interface NativeFrame {
	_utilityContext(): Promise<{
		injectedScript(): Promise<{
			evaluate(
				fn: typeof serializeNativeSnapshot,
				options: { maxBytes: number; boxes: boolean },
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
// The controller retires the owning lease on rejection, including timeout,
// before accepting another command; native in-flight capture cannot be reused.
export const captureBrowserSnapshotJSON: PlaywrightSnapshotJSONCapture = async (
	page,
	options,
) => {
	const native = page as typeof page & NativeSnapshotPage;
	const signal = AbortSignal.any([
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
	const encoder = new TextEncoder();
	let remaining = options.maxBytes;
	const forest: SnapshotNode[] = [];
	const pending = [{ frame: root, target: forest }];
	const visit = async (index: number): Promise<void> => {
		options.signal.throwIfAborted();
		const entry = pending[index];
		if (!entry) return;
		if (index >= MAX_SNAPSHOT_FRAMES)
			throw new Error("Browser snapshot frame limit exceeded");
		const context = await entry.frame._utilityContext();
		const injected = await context.injectedScript();
		const result = await injected.evaluate(serializeNativeSnapshot, {
			maxBytes: remaining,
			boxes: options.boxes ?? false,
		});
		remaining -= encoder.encode(JSON.stringify(result.nodes)).byteLength;
		entry.target.push(...result.nodes);
		const byRef = indexNodes(result.nodes);
		if (pending.length + result.iframeRefs.length > MAX_SNAPSHOT_FRAMES)
			throw new Error("Browser snapshot frame limit exceeded");
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
				return { frame: resolved.frame, target: target.children };
			}),
		);
		pending.push(...children.filter((child) => child !== undefined));
		// Frame serialization shares one byte budget, so admit transfers in order.
		await visit(index + 1);
	};
	await visit(0);
	if (encoder.encode(JSON.stringify(forest)).byteLength > options.maxBytes)
		throw new Error("Browser snapshot JSON limit exceeded");
	return forest;
}

/** O(nodes), bounded by the renderer's byte and 20,000-node admission. */
function indexNodes(nodes: SnapshotNode[]) {
	const byRef = new Map<string, SnapshotNode>();
	const pending = [...nodes];
	for (let index = 0; index < pending.length; index++) {
		const node = pending[index];
		if (!node) continue;
		if (node.ref) byRef.set(node.ref, node);
		if (node.children) pending.push(...node.children);
	}
	return byRef;
}
