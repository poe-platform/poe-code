import { PlaywrightResourceLimitError } from "@poe-platform/safe-bash/playwright";

// The separate owned-browser privacy transport still uses this legacy budget.
export const MAX_RUN_CODE_FRAME_BYTES = 32 * 1024 * 1024;
export const MAX_RUN_CODE_CONTEXTS = 16;
export const MAX_RUN_CODE_TARGETS = 64;

interface ProtocolMessage {
	id?: number;
	method?: string;
	sessionId?: string;
	params?: Record<string, unknown>; // type-erasure-boundary -- Arbitrary native CDP parameters are forwarded; creation fields are validated before accounting.
	result?: Record<string, unknown>; // type-erasure-boundary -- Native CDP replies vary by method; only validated creation IDs enter resource accounting.
	error?: unknown;
}

export interface RunCodeFrameLimits {
	maxFrameBytes?: number;
	maxBytes?: number;
	maxFrames?: number;
}

/** O(n) in code points, O(1) auxiliary memory. */
export function frameByteLength(message: string) {
	let bytes = 0;
	for (const character of message) {
		const codePoint = character.codePointAt(0)!;
		bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
	}
	return bytes;
}

/** Omitted budgets never constrain the total traffic or individual frames. */
export function createRunCodeFrameBudget(limits: RunCodeFrameLimits = {}) {
	for (const [name, value] of Object.entries(limits)) {
		if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
			throw new TypeError(`Invalid run-code CDP limit: ${name}`);
	}
	let frames = 0;
	let bytes = 0;
	return (message: unknown): ProtocolMessage => {
		if (typeof message !== "string") throw new Error("Run-code CDP frame limit or type violation");
		const size =
			limits.maxFrameBytes !== undefined || limits.maxBytes !== undefined
				? frameByteLength(message)
				: 0;
		if (limits.maxFrameBytes !== undefined && size > limits.maxFrameBytes)
			throw new PlaywrightResourceLimitError("Run-code CDP frame limit exceeded");
		if (limits.maxFrames !== undefined) frames++;
		if (limits.maxBytes !== undefined) bytes += size;
		if (
			(limits.maxFrames !== undefined && frames > limits.maxFrames) ||
			(limits.maxBytes !== undefined && bytes > limits.maxBytes)
		)
			throw new PlaywrightResourceLimitError("Run-code CDP transport limit exceeded");
		const parsed: unknown = JSON.parse(message);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("Invalid run-code CDP message");
		return parsed;
	};
}

/** Reservations count before forwarding, including commands awaiting replies. */
export function createRunCodeCreationBudget(options: {
	maxPages: number;
	pages: Iterable<string>;
	contexts: Iterable<string>;
}) {
	const pages = new Set(options.pages);
	const contexts = new Set(options.contexts);
	const pending = new Map<number, "page" | "context">();
	const disposals = new Map<number, string>();
	const groups = {
		page: { ids: pages, limit: options.maxPages, field: "targetId" },
		context: {
			ids: contexts,
			limit: MAX_RUN_CODE_CONTEXTS,
			field: "browserContextId"
		}
	};
	const count = (kind: "page" | "context") =>
		[...pending.values()].filter((value) => value === kind).length;
	const reserveDisposal = (message: ProtocolMessage) => {
		if (!Number.isSafeInteger(message.id) || pending.has(message.id!) || disposals.has(message.id!))
			throw new Error("Invalid run-code creation command ID");
		const id = message.params?.["browserContextId"];
		if (typeof id === "string") disposals.set(message.id!, id);
	};
	const confirmDisposal = (message: ProtocolMessage) => {
		const disposed = disposals.get(message.id!);
		if (disposed === undefined) return false;
		disposals.delete(message.id!);
		if (!message.error) contexts.delete(disposed);
		return true;
	};
	return {
		command(message: ProtocolMessage) {
			if (message.method === "Target.disposeBrowserContext") {
				reserveDisposal(message);
				return;
			}
			const kind = creationKind(message.method);
			if (!kind) return;
			if (
				!Number.isSafeInteger(message.id) ||
				pending.has(message.id!) ||
				disposals.has(message.id!)
			)
				throw new Error("Invalid run-code creation command ID");
			const group = groups[kind];
			if (group.ids.size + count(kind) >= group.limit)
				throw new PlaywrightResourceLimitError(`Run-code ${kind} limit exceeded`);
			pending.set(message.id!, kind);
		},
		reply(message: ProtocolMessage) {
			if (message.id === undefined) return;
			if (confirmDisposal(message)) return;
			const kind = pending.get(message.id);
			if (!kind) return;
			pending.delete(message.id);
			if (message.error) return;
			const group = groups[kind];
			const id = message.result?.[group.field];
			if (typeof id !== "string") throw new Error("Invalid CDP creation response");
			group.ids.add(id);
		},
		pageCreated(id: string) {
			pages.add(id);
			if (pages.size > options.maxPages)
				throw new PlaywrightResourceLimitError("Run-code page limit exceeded");
		},
		pageDestroyed(id: string) {
			pages.delete(id);
		}
	};
}

function creationKind(method: string | undefined) {
	if (method === "Target.createTarget") return "page";
	if (method === "Target.createBrowserContext") return "context";
	return undefined;
}
