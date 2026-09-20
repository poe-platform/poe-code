import { vi, beforeEach } from "vitest";
import { vol } from "memfs";
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
beforeEach(() => { vol.reset(); vol.mkdirSync("/tmp", {recursive: true}); });
import { access, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { captureBrowserArtifact } from "../src/browser-artifact";

test("native browser artifact bytes are copied and their private file is removed", async () => {
	let path = "";
	const bytes = new Uint8Array([0, 255, 80, 75]);
	const result = await captureBrowserArtifact(
		async (file) => {
			path = file;
			await writeFile(file, bytes);
		},
		{ signal: new AbortController().signal, maxBytes: 4, extension: "zip" },
	);
	expect(result).toEqual(bytes);
	await expect(access(path)).rejects.toThrow();
});

test("oversized and failed artifact producers retire their temporary files", async () => {
	let path = "";
	await expect(
		captureBrowserArtifact(
			async (file) => {
				path = file;
				await writeFile(file, new Uint8Array(5));
			},
			{ signal: new AbortController().signal, maxBytes: 4, extension: "zip" },
		),
	).rejects.toThrow("limit");
	await expect(access(path)).rejects.toThrow();
	await expect(
		captureBrowserArtifact(
			async (file) => {
				path = file;
				await writeFile(file, "partial");
				throw new Error("producer failed");
			},
			{ signal: new AbortController().signal, maxBytes: 20, extension: "zip" },
		),
	).rejects.toThrow("producer failed");
	await expect(access(path)).rejects.toThrow();
});

test("cancelled captures wait for the admitted producer before deleting its output", async () => {
	const admitted = Promise.withResolvers<string>();
	const release = Promise.withResolvers<void>();
	const controller = new AbortController();
	const capture = captureBrowserArtifact(
		async (file) => {
			admitted.resolve(file);
			await release.promise;
			await writeFile(file, "late");
		},
		{ signal: controller.signal, maxBytes: 20, extension: "zip" },
	);
	const path = await admitted.promise;
	controller.abort(new Error("cancelled"));
	const result = capture.then(
		() => "unexpected success",
		(error: Error) => error.message,
	);
	release.resolve();
	expect(await result).toBe("cancelled");
	await expect(access(path)).rejects.toThrow();
});
