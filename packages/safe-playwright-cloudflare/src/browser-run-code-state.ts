import {
	isRunCodeContextState,
	type RunCodeContextState,
} from "./browser-run-code-context-state.js";

export const MAX_PAGE_STATE_BYTES = 64 * 1024;
export const MAX_RUN_CODE_INIT_SCRIPTS = 256;
const mediaValues = {
	media: ["screen", "print", "no-override"],
	colorScheme: ["dark", "light", "no-preference", "no-override"],
	reducedMotion: ["reduce", "no-preference", "no-override"],
	forcedColors: ["active", "none", "no-override"],
	contrast: ["more", "no-preference", "no-override"],
} as const;
type Media = {
	[K in keyof typeof mediaValues]?: (typeof mediaValues)[K][number];
};
type Dimensions = { width: number; height: number };
export interface RunCodeTimeouts {
	/** Null leaves this level unset so native parent/default inheritance applies. */
	action: number | null;
	navigation: number | null;
}
export interface RunCodePageState {
	targetId: string;
	viewport: Dimensions | null;
	size: { viewport: Dimensions; screen: Dimensions } | null;
	media: Media;
	timeouts: RunCodeTimeouts;
	initScripts: string[];
}
export interface RunCodeState {
	context: RunCodeContextState;
	pages: RunCodePageState[];
	contextInitScripts: string[];
	contextTimeouts: RunCodeTimeouts;
}

// type-erasure-boundary -- JSON completion data comes from the untrusted Worker guest.
function allowedObject<Key extends string>(
	value: unknown,
	keys: readonly Key[],
): value is Partial<Record<Key, unknown>> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).every((key) => keys.includes(key as Key))
	);
}
function dimensions(value: unknown): value is Dimensions {
	if (!allowedObject(value, ["width", "height"])) return false;
	return [value.width, value.height].every(
		(dimension) =>
			typeof dimension === "number" &&
			Number.isSafeInteger(dimension) &&
			dimension >= 1 &&
			dimension <= 32768,
	);
}
function media(value: unknown): value is Media {
	if (!allowedObject(value, Object.keys(mediaValues))) return false;
	return Object.entries(value).every(
		([key, entry]) =>
			typeof entry === "string" &&
			(mediaValues[key as keyof Media] as readonly string[]).includes(entry),
	);
}
function emulatedSize(value: unknown): value is RunCodePageState["size"] {
	return (
		value === null ||
		(allowedObject(value, ["viewport", "screen"]) &&
			dimensions(value.viewport) &&
			dimensions(value.screen))
	);
}
function scripts(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length <= MAX_RUN_CODE_INIT_SCRIPTS &&
		value.every((source) => typeof source === "string")
	);
}
function timeouts(value: unknown): value is RunCodeTimeouts {
	if (!allowedObject(value, ["action", "navigation"])) return false;
	return [value.action, value.navigation].every(
		(timeout) =>
			timeout === null ||
			(typeof timeout === "number" && Number.isFinite(timeout) && timeout >= 0),
	);
}
function pageState(value: unknown): value is RunCodePageState {
	if (
		!allowedObject(value, [
			"targetId",
			"viewport",
			"size",
			"media",
			"initScripts",
			"timeouts",
		])
	)
		return false;
	const id = value.targetId;
	return (
		typeof id === "string" &&
		id.length > 0 &&
		id.length <= 256 &&
		(value.viewport === null || dimensions(value.viewport)) &&
		emulatedSize(value.size) &&
		media(value.media) &&
		timeouts(value.timeouts) &&
		scripts(value.initScripts)
	);
}

/** Fixed schema and byte cap bound the guest's separate native state response. */
export function parseRunCodeState(json: string): RunCodeState {
	if (
		typeof json !== "string" ||
		new TextEncoder().encode(json).byteLength > MAX_PAGE_STATE_BYTES
	)
		throw new Error("Run-code page state byte limit exceeded");
	return validateRunCodeState(JSON.parse(json));
}

/** Shared native schema; portable profiles enforce their total byte budget separately. */
export function validateRunCodeState(value: unknown): RunCodeState {
	if (
		!allowedObject(value, [
			"pages",
			"contextInitScripts",
			"contextTimeouts",
			"context",
		]) ||
		!isRunCodeContextState(value.context) ||
		!Array.isArray(value.pages) ||
		value.pages.length > 64 ||
		!value.pages.every(pageState) ||
		!scripts(value.contextInitScripts) ||
		!timeouts(value.contextTimeouts) ||
		value.contextInitScripts.length +
			value.pages.reduce((count, page) => count + page.initScripts.length, 0) >
			MAX_RUN_CODE_INIT_SCRIPTS
	)
		throw new Error("Invalid run-code page state");
	return {
		context: value.context,
		pages: value.pages,
		contextInitScripts: value.contextInitScripts,
		contextTimeouts: value.contextTimeouts,
	};
}
export function serializeRunCodeState(state: RunCodeState): string {
	const json = JSON.stringify(state);
	parseRunCodeState(json);
	return json;
}
