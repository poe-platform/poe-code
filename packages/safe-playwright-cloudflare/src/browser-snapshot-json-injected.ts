import type { PlaywrightSnapshotJSONNode } from "@poe-platform/safe-bash/playwright";

export type SnapshotNode = {
	-readonly [Key in keyof PlaywrightSnapshotJSONNode]: Key extends "children"
		? (SnapshotNode | string)[]
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
	const snapshot = injected._lastAriaSnapshotForQuery;
	if (!snapshot) throw new Error("Native browser snapshot is unavailable");
	const encoder = new TextEncoder();
	const limited = Number.isFinite(options.maxBytes);
	let bytes = 2;
	if (bytes > options.maxBytes) return { limit: "byte" as const };
	const account = (node: SnapshotNode | string, parent: (SnapshotNode | string)[]) => {
		if (!limited) return true;
		// Empty child arrays are counted with their parent; descendants add only
		// their own shallow encoding and the comma preceding each later sibling.
		bytes += encoder.encode(JSON.stringify(node)).byteLength + Number(parent.length > 0);
		return bytes <= options.maxBytes;
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
	const nodes: SnapshotNode[] = [];
	// Admit each node before allocating traversal state for its descendants.
	const pending = [{ children: snapshot.root.children, index: 0, parent: nodes as (SnapshotNode | string)[] }];
	while (pending.length) {
		const entry = pending[pending.length - 1]!;
		if (entry.index === entry.children.length) {
			pending.pop();
			continue;
		}
		const node = entry.children[entry.index++]!;
		if (typeof node === "string") {
			const text = entry.parent === nodes ? { role: "text", text: node } : node;
			if (!account(text, entry.parent)) return { limit: "byte" as const };
			entry.parent.push(text);
			continue;
		}
		const result = convertElement(node);
		if (node.children.length === 1 && typeof node.children[0] === "string")
			result.text = node.children[0];
		if (node.children.length && result.text === undefined) result.children = [];
		if (!account(result, entry.parent)) return { limit: "byte" as const };
		entry.parent.push(result);
		if (result.children) pending.push({ children: node.children, index: 0, parent: result.children });
	}
	const result = { nodes, iframeRefs: snapshot.iframeRefs };
	return result;
}
