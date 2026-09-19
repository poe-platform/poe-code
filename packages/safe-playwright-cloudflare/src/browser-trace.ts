import { lstat, open } from "node:fs/promises";
import {
	PlaywrightResourceLimitError,
	type PlaywrightTraceCapture,
} from "@poe-platform/safe-bash/playwright";

const MAX_TRACE_FILES = 1024;
const MAX_TRACE_PATH = 256;
interface NativeTracePaths {
	tracesDir: string;
	traceFile: string;
	networkFile: string;
	resourcesDir: string;
	traceSha1s: Set<string>;
	networkSha1s: Set<string>;
}
interface NativeTracing {
	_state?: NativeTracePaths;
	_fs: { syncAndGetError(): Promise<Error | undefined> };
}
const pathsByTracing = new WeakMap<object, NativeTracePaths>();

function safeName(name: string): boolean {
	return (
		name.length > 0 &&
		name.length <= MAX_TRACE_PATH &&
		name !== "." &&
		name !== ".." &&
		[...name].every((character) =>
			"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-@".includes(
				character,
			),
		)
	);
}

function nativeTracing(
	context: Parameters<PlaywrightTraceCapture>[0],
): NativeTracing {
	// @cloudflare/playwright 1.3.6 embeds its server inside the Worker. Only these
	// pinned native internals own the trace paths; page data never supplies them.
	const tracing = context.tracing as unknown as {
		// type-erasure-boundary -- The pinned provider exposes native trace ownership only through its private connection bridge.
		_connection?: { toImpl(value: unknown): NativeTracing };
	};
	if (!tracing?._connection?.toImpl)
		throw new Error("Playwright provider does not support live trace capture");
	const native = tracing._connection.toImpl(tracing);
	if (!native?._fs?.syncAndGetError)
		throw new Error("Native browser tracing unavailable");
	return native;
}

function tracePaths(native: NativeTracing): NativeTracePaths {
	const state = native._state;
	if (!state) {
		const previous = pathsByTracing.get(native);
		if (!previous) throw new Error("Native browser trace has not started");
		return previous;
	}
	const paths = {
		tracesDir: state.tracesDir,
		traceFile: state.traceFile,
		networkFile: state.networkFile,
		resourcesDir: state.resourcesDir,
		traceSha1s: state.traceSha1s,
		networkSha1s: state.networkSha1s,
	};
	const rootName = paths.tracesDir?.slice("/tmp/".length);
	if (
		!paths.tracesDir?.startsWith("/tmp/playwright-artifacts-") ||
		!safeName(rootName)
	)
		throw new Error("Invalid native browser trace directory");
	for (const path of [paths.traceFile, paths.networkFile]) {
		if (
			!path.startsWith(`${paths.tracesDir}/`) ||
			!safeName(path.slice(paths.tracesDir.length + 1))
		)
			throw new Error("Invalid native browser trace path");
	}
	if (paths.resourcesDir !== `${paths.tracesDir}/resources`)
		throw new Error("Invalid native browser trace resources");
	pathsByTracing.set(native, paths);
	return paths;
}

async function readTraceFile(options: {
	path: string;
	signal: AbortSignal;
	remaining: number;
}): Promise<Uint8Array> {
	const { path, signal, remaining } = options;
	signal.throwIfAborted();
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink())
		throw new Error("Native trace must be a regular file");
	if (metadata.size > remaining)
		throw new PlaywrightResourceLimitError("Browser trace byte limit exceeded");
	const file = await open(path, "r");
	try {
		const current = await file.stat();
		if (
			!current.isFile() ||
			current.ino !== metadata.ino ||
			current.dev !== metadata.dev
		)
			throw new Error("Native trace file changed during capture");
		const bytes = new Uint8Array(metadata.size);
		let offset = 0;
		while (offset < bytes.length) {
			signal.throwIfAborted();
			// biome-ignore lint/performance/noAwaitInLoops: Each short read advances the same bounded file cursor.
			const { bytesRead } = await file.read(
				bytes,
				offset,
				bytes.length - offset,
				offset,
			);
			if (!bytesRead)
				throw new Error("Native trace file truncated during capture");
			offset += bytesRead;
		}
		return bytes;
	} finally {
		await file.close();
	}
}

function traceResources(paths: NativeTracePaths): string[] {
	if (
		!(paths.traceSha1s instanceof Set) ||
		!(paths.networkSha1s instanceof Set)
	)
		throw new Error("Native trace resource ownership unavailable");
	if (
		paths.traceSha1s.size > MAX_TRACE_FILES ||
		paths.networkSha1s.size > MAX_TRACE_FILES
	)
		throw new PlaywrightResourceLimitError(
			"Browser trace file count limit exceeded",
		);
	return [...paths.traceSha1s, ...paths.networkSha1s];
}

async function traceFiles(
	paths: NativeTracePaths,
	signal: AbortSignal,
): Promise<string[]> {
	const root = await lstat(paths.tracesDir);
	const resources = await lstat(paths.resourcesDir);
	if (!root.isDirectory() || !resources.isDirectory())
		throw new Error("Native trace paths must be directories");
	const candidates = [paths.traceFile, paths.networkFile];
	const seen = new Set<string>();
	// Keep references to the native recording's sets: stop replaces the state
	// fields, while these sets still own its final resources, never sibling traces.
	for (const name of traceResources(paths)) {
		signal.throwIfAborted();
		if (seen.has(name)) continue;
		if (candidates.length >= MAX_TRACE_FILES)
			throw new PlaywrightResourceLimitError(
				"Browser trace file count limit exceeded",
			);
		if (!safeName(name))
			throw new Error("Invalid native browser trace resource name");
		seen.add(name);
		candidates.push(`${paths.resourcesDir}/${name}`);
	}
	return candidates;
}

/** O(files + bytes), capped at 1024 files and the caller's aggregate byte limit.
 * Native tracing can append after its flush; each read captures the admitted
 * prefix, preserving future appends for the next command's flush. */
export const captureBrowserTrace: PlaywrightTraceCapture = async (
	context,
	options,
) => {
	options.signal.throwIfAborted();
	if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)
		throw new Error("Invalid browser trace byte limit");
	const native = nativeTracing(context);
	const paths = tracePaths(native);
	const failure = await native._fs.syncAndGetError();
	if (failure) throw failure;
	const candidates = await traceFiles(paths, options.signal);
	const files: { path: string; bytes: Uint8Array }[] = [];
	let remaining = options.maxBytes;
	for (const path of candidates) {
		// biome-ignore lint/performance/noAwaitInLoops: Admission decrements the shared aggregate byte budget before the next file.
		const bytes = await readTraceFile({
			path,
			signal: options.signal,
			remaining,
		});
		remaining -= bytes.byteLength;
		files.push({ path: path.slice(paths.tracesDir.length + 1), bytes });
	}
	options.signal.throwIfAborted();
	return { files };
};
