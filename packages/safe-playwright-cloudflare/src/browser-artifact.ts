import { mkdtemp, open, rm } from "node:fs/promises";
import type { PlaywrightArtifactCapture } from "@poe-platform/safe-bash/playwright";

/** Cloudflare's tracing client writes to its private /tmp filesystem. Read a
 * bounded artifact only after the producer settles, and always retire its files. */
export const captureBrowserArtifact: PlaywrightArtifactCapture = async (
	produce,
	options,
) => {
	const { signal, maxBytes, extension } = options;
	signal.throwIfAborted();
	if (
		!Number.isSafeInteger(maxBytes) ||
		maxBytes < 1 ||
		!extension ||
		extension.length > 16 ||
		[...extension].some(
			(letter) => !"abcdefghijklmnopqrstuvwxyz0123456789".includes(letter),
		)
	)
		throw new Error("Invalid browser artifact options");
	const directory = await mkdtemp("/tmp/poe-browser-artifact-");
	try {
		signal.throwIfAborted();
		const path = `${directory}/artifact.${extension}`;
		await produce(path);
		signal.throwIfAborted();
		const file = await open(path, "r");
		try {
			const stat = await file.stat();
			if (!stat.isFile() || stat.size > maxBytes)
				throw new Error("Browser artifact byte limit exceeded");
			const bytes = new Uint8Array(stat.size + 1);
			let offset = 0;
			while (offset < bytes.byteLength) {
				signal.throwIfAborted();
				// biome-ignore lint/performance/noAwaitInLoops: Each short read advances the same file cursor and bounded destination.
				const { bytesRead } = await file.read(
					bytes,
					offset,
					bytes.byteLength - offset,
					null,
				);
				if (!bytesRead) break;
				offset += bytesRead;
			}
			if (offset !== stat.size)
				throw new Error("Browser artifact changed during capture");
			signal.throwIfAborted();
			return bytes.slice(0, offset);
		} finally {
			await file.close();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
};
