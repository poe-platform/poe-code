import type { PlaywrightSnapshotJSONNode } from "@poe-platform/safe-bash/playwright";

export type SnapshotNode = {
	-readonly [Key in keyof PlaywrightSnapshotJSONNode]: Key extends "children"
		? SnapshotNode[]
		: PlaywrightSnapshotJSONNode[Key];
};

interface NativeAriaNode {
	role: string;
	name: string;
	children: (NativeAriaNode | string)[];
	props: { url?: string; placeholder?: string };
	box: { cursor?: string; visible: boolean; inline: boolean };
	ref?: string;
	checked?: boolean | "mixed";
	disabled?: boolean;
	expanded?: boolean;
	active?: boolean;
	level?: number;
	pressed?: boolean | "mixed";
	selected?: boolean;
	[key: symbol]: Element;
}

export interface NativeSnapshotScript {
	_lastAriaSnapshotForQuery?: {
		root: NativeAriaNode;
		iframeRefs: string[];
	};
}

/** Runs in the native utility world. O(nodes + bytes), bounded before CDP transfer. */
export function serializeNativeSnapshot(
	injected: NativeSnapshotScript,
	options: { maxBytes: number; boxes: boolean },
) {
	const MAX_SNAPSHOT_NODES = 20000;
	const snapshot = injected._lastAriaSnapshotForQuery;
	if (!snapshot) throw new Error("Native browser snapshot is unavailable");
	const encoder = new TextEncoder();
	let bytes = 2;
	let count = 0;
	const account = (node: SnapshotNode) => {
		// Reserve array/property separators while counting each shallow node once.
		bytes += encoder.encode(JSON.stringify(node)).byteLength + 16;
		if (bytes > options.maxBytes || ++count > MAX_SNAPSHOT_NODES)
			throw new Error("Browser snapshot JSON limit exceeded");
	};
	const rectangle = (node: NativeAriaNode) => {
		const symbol = Object.getOwnPropertySymbols(node).find(
			(key) => key.description === "element",
		);
		const element = symbol && node[symbol];
		if (!element) throw new Error("Native snapshot element is unavailable");
		const { x, y, width, height } = element.getBoundingClientRect();
		return {
			x: Math.round(x),
			y: Math.round(y),
			width: Math.round(width),
			height: Math.round(height),
		};
	};
	const convertElement = (node: NativeAriaNode): SnapshotNode => {
		const result: SnapshotNode = { role: node.role };

		for (const key of [
			"name",
			"ref",
			"checked",
			"disabled",
			"expanded",
			"active",
			"level",
			"pressed",
			"selected",
		] as const) {
			if (node[key]) Object.assign(result, { [key]: node[key] });
		}
		if (node.ref && node.box.cursor === "pointer") result.cursor = "pointer";
		Object.assign(result, node.props);
		if (options.boxes) result.box = rectangle(node);
		return result;
	};
	const convert = (node: NativeAriaNode | string): SnapshotNode =>
		typeof node === "string"
			? { role: "text", text: node }
			: convertElement(node);
	const nodes: SnapshotNode[] = [];
	if (snapshot.root.children.length > MAX_SNAPSHOT_NODES)
		throw new Error("Browser snapshot JSON limit exceeded");
	const pending = snapshot.root.children.map((node) => ({
		node,
		parent: nodes,
	}));
	const visit = (entry: (typeof pending)[number]) => {
		const result = convert(entry.node);
		account(result);
		entry.parent.push(result);
		if (typeof entry.node === "string" || !entry.node.children.length) return;
		result.children = [];
		if (pending.length + entry.node.children.length > MAX_SNAPSHOT_NODES)
			throw new Error("Browser snapshot JSON limit exceeded");
		for (const child of entry.node.children)
			pending.push({ node: child, parent: result.children });
	};
	for (const entry of pending) visit(entry);
	const result = { nodes, iframeRefs: snapshot.iframeRefs };
	if (encoder.encode(JSON.stringify(result)).byteLength > options.maxBytes)
		throw new Error("Browser snapshot JSON limit exceeded");
	return result;
}
