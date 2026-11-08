import type { FileStat, FileSystem } from "@poe-code/safe-fs/core";
import {
	PlaywrightResourceLimitError,
	type PlaywrightTraceCapture
} from "@poe-platform/safe-bash/playwright";

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
		name !== "." &&
		name !== ".." &&
		[...name].every((character) =>
			"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-@".includes(character)
		)
	);
}

function nativeTracing(context: Parameters<PlaywrightTraceCapture>[0]): NativeTracing {
	// @cloudflare/playwright 1.3.6 embeds its server inside the Worker. Only these
	// pinned native internals own the trace paths; page data never supplies them.
	const tracing = context.tracing as unknown as {
		// type-erasure-boundary -- The pinned provider exposes native trace ownership only through its private connection bridge.
		_connection?: { toImpl(value: unknown): NativeTracing };
	};
	if (!tracing?._connection?.toImpl)
		throw new Error("Playwright provider does not support live trace capture");
	const native = tracing._connection.toImpl(tracing);
	if (!native?._fs?.syncAndGetError) throw new Error("Native browser tracing unavailable");
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
		networkSha1s: state.networkSha1s
	};
	const rootName = paths.tracesDir?.slice("/tmp/".length);
	if (!paths.tracesDir?.startsWith("/tmp/playwright-artifacts-") || !safeName(rootName))
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

function hasTraceIdentity(stat: FileStat): boolean {
  return (typeof stat.identityScope === "symbol" || typeof stat.identityScope === "object" && stat.identityScope !== null)
    && typeof stat.dev === "number" && Number.isSafeInteger(stat.dev) && stat.dev >= 0
    && typeof stat.ino === "number" && Number.isSafeInteger(stat.ino) && stat.ino >= 0
    && (stat.identityScope !== Symbol.for("virtual-bash.fs.native") || stat.ino > 0);
}

async function readTraceFile(options: {
	path: string;
	signal: AbortSignal;
	remaining: number;
	fs: FileSystem;
}): Promise<Uint8Array> {
	const { path, signal, remaining, fs } = options;
	signal.throwIfAborted();
	const metadata = await fs.lstat(path, { signal });
	if (metadata.type !== "file") throw new Error("Native trace must be a regular file");
  if (!hasTraceIdentity(metadata)) throw new Error("Native trace file identity unavailable");
	if (metadata.size > remaining)
		throw new PlaywrightResourceLimitError("Browser trace byte limit exceeded");
	if (!fs.openReadFile) throw new Error("Native trace retained reads unavailable");
	const file = await fs.openReadFile(path, { signal });
	try {
		const current = await file.stat({ signal });
    if (!hasTraceIdentity(current)) throw new Error("Native trace file identity unavailable");
		if (
			current.type !== "file" ||
			current.identityScope !== metadata.identityScope ||
			current.ino !== metadata.ino ||
			current.dev !== metadata.dev
		)
			throw new Error("Native trace file changed during capture");
		const bytes = new Uint8Array(metadata.size);
		let offset = 0;
		while (offset < bytes.length) {
			signal.throwIfAborted();
			// biome-ignore lint/performance/noAwaitInLoops: Each short read advances the same bounded file cursor.
			const chunk = await file.read(offset, Math.min(65536, bytes.length - offset), { signal });
			const bytesRead = chunk.byteLength;
			bytes.set(chunk, offset);
			if (!bytesRead) throw new Error("Native trace file truncated during capture");
			offset += bytesRead;
		}
		return bytes;
	} finally {
		await file.close();
	}
}

function traceResources(paths: NativeTracePaths): string[] {
	if (!(paths.traceSha1s instanceof Set) || !(paths.networkSha1s instanceof Set))
		throw new Error("Native trace resource ownership unavailable");
	return [...paths.traceSha1s, ...paths.networkSha1s];
}

async function traceFiles(
	paths: NativeTracePaths,
	signal: AbortSignal,
	fs: FileSystem
): Promise<string[]> {
	const root = await fs.lstat(paths.tracesDir, { signal });
	const resources = await fs.lstat(paths.resourcesDir, { signal });
	if (root.type !== "directory" || resources.type !== "directory")
		throw new Error("Native trace paths must be directories");
	const candidates = [paths.traceFile, paths.networkFile];
	const seen = new Set<string>();
	// Keep references to the native recording's sets: stop replaces the state
	// fields, while these sets still own its final resources, never sibling traces.
	for (const name of traceResources(paths)) {
		signal.throwIfAborted();
		if (seen.has(name)) continue;
		if (!safeName(name)) throw new Error("Invalid native browser trace resource name");
		seen.add(name);
		candidates.push(`${paths.resourcesDir}/${name}`);
	}
	return candidates;
}

/** O(files + bytes), subject to the caller's aggregate byte limit.
 * Native tracing can append after its flush; each read captures the admitted
 * prefix, preserving future appends for the next command's flush. */
export async function captureBrowserTrace(
	context: Parameters<PlaywrightTraceCapture>[0],
	options: Parameters<PlaywrightTraceCapture>[1],
	fs: FileSystem | undefined
): ReturnType<PlaywrightTraceCapture> {
	options.signal.throwIfAborted();
	if (
		options.maxBytes !== Infinity &&
		(!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)
	)
		throw new Error("Invalid browser trace byte limit");
	if (!fs) throw new Error("Browser trace filesystem unavailable");
	const native = nativeTracing(context);
	const paths = tracePaths(native);
	const failure = await native._fs.syncAndGetError();
	if (failure) throw failure;
	const candidates = await traceFiles(paths, options.signal, fs);
	const files: { path: string; bytes: Uint8Array }[] = [];
	let remaining = options.maxBytes;
	for (const path of candidates) {
		// biome-ignore lint/performance/noAwaitInLoops: Admission decrements the shared aggregate byte budget before the next file.
		const bytes = await readTraceFile({
			path,
			signal: options.signal,
			remaining,
			fs
		});
		remaining -= bytes.byteLength;
		files.push({ path: path.slice(paths.tracesDir.length + 1), bytes });
	}
	options.signal.throwIfAborted();
	return { files };
}
