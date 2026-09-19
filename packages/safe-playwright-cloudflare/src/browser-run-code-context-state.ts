import type {
	BrowserContext,
	BrowserContextOptions,
} from "@cloudflare/playwright";

export interface RunCodeHeader {
	name: string;
	value: string;
}
export interface RunCodeContextState {
	headers: RunCodeHeader[];
	offline: boolean;
	geolocation: NonNullable<BrowserContextOptions["geolocation"]> | null;
}

function header(value: unknown): value is RunCodeHeader {
	if (
		!value ||
		typeof value !== "object" ||
		!("name" in value) ||
		!("value" in value)
	)
		return false;
	if (typeof value.name !== "string" || typeof value.value !== "string")
		return false;
	try {
		new Headers([[value.name, value.value]]);
		return true;
	} catch {
		return false;
	}
}
function geolocation(
	value: unknown,
): value is RunCodeContextState["geolocation"] {
	if (value === null) return true;
	if (
		!value ||
		typeof value !== "object" ||
		!("latitude" in value) ||
		!("longitude" in value)
	)
		return false;
	return (
		typeof value.latitude === "number" &&
		Number.isFinite(value.latitude) &&
		Math.abs(value.latitude) <= 90 &&
		typeof value.longitude === "number" &&
		Number.isFinite(value.longitude) &&
		Math.abs(value.longitude) <= 180 &&
		(!("accuracy" in value) ||
			(typeof value.accuracy === "number" &&
				Number.isFinite(value.accuracy) &&
				value.accuracy >= 0))
	);
}

/** The completion envelope already bounds aggregate bytes; preserve native API ranges. */
export function isRunCodeContextState(
	value: unknown,
): value is RunCodeContextState {
	return (
		!!value &&
		typeof value === "object" &&
		"headers" in value &&
		Array.isArray(value.headers) &&
		value.headers.every(header) &&
		"offline" in value &&
		typeof value.offline === "boolean" &&
		"geolocation" in value &&
		geolocation(value.geolocation)
	);
}

export async function restoreRunCodeContextState(
	context: BrowserContext,
	state: RunCodeContextState,
) {
	await Promise.all([
		context.setExtraHTTPHeaders(
			Object.fromEntries(state.headers.map(({ name, value }) => [name, value])),
		),
		context.setOffline(state.offline),
		context.setGeolocation(state.geolocation),
	]);
}
