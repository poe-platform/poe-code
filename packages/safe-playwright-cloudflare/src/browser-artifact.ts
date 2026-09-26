import type { FileSystem } from "@poe-code/safe-fs/core";
import type { PlaywrightArtifactCapture } from "@poe-platform/safe-bash/playwright";

/** Cloudflare's tracing client writes to its private /tmp filesystem. Read a
 * bounded artifact only after the producer settles, and always retire its files. */
export async function captureBrowserArtifact(
	produce: Parameters<PlaywrightArtifactCapture>[0],
	options: Parameters<PlaywrightArtifactCapture>[1],
	fs: FileSystem | undefined
): Promise<Uint8Array> {
	const { signal, maxBytes, extension } = options;
	signal.throwIfAborted();
	if (
		(maxBytes !== Infinity && !Number.isSafeInteger(maxBytes)) ||
		maxBytes < 1 ||
		!extension ||
		extension.length > 16 ||
		[...extension].some((letter) => !"abcdefghijklmnopqrstuvwxyz0123456789".includes(letter))
	)
		throw new Error("Invalid browser artifact options");
	if (!fs) throw new Error("Browser artifact filesystem unavailable");
	const directory = `/tmp/poe-browser-artifact-${crypto.randomUUID()}`;
	await fs.mkdir(directory, { signal, mode: 0o700 });
	try {
		signal.throwIfAborted();
		const path = `${directory}/artifact.${extension}`;
		await produce(path);
		signal.throwIfAborted();
		const metadata = await fs.lstat(path, { signal });
		if (metadata.type !== "file") throw new Error("Browser artifact must be a regular file");
		if (!fs.openReadFile) throw new Error("Browser artifact retained reads unavailable");
		const file = await fs.openReadFile(path, { signal });
		try {
			const stat = await file.stat({ signal });
			if (stat.type !== "file" || stat.size > maxBytes)
				throw new Error("Browser artifact byte limit exceeded");
			if (!Number.isSafeInteger(stat.size) || stat.size < 0)
				throw new Error("Invalid browser artifact size");
			const bytes = new Uint8Array(stat.size + 1);
			let offset = 0;
			while (offset < bytes.byteLength) {
				const chunk = await file.read(offset, Math.min(65536, bytes.byteLength - offset), {
					signal
				});
				if (!chunk.byteLength) break;
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			if (offset !== stat.size) throw new Error("Browser artifact changed during capture");
			signal.throwIfAborted();
			return bytes.slice(0, offset);
		} finally {
			await file.close();
		}
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}
