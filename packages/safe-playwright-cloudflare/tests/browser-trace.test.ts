import { vi, beforeEach } from "vitest";
import { vol } from "memfs";
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
beforeEach(() => { vol.reset(); vol.mkdirSync("/tmp", {recursive: true}); });
import { describe, expect, test } from "vitest";
import {
	appendFile,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { captureBrowserTrace } from "../src/browser-trace";

async function fixture() {
	const directory = await mkdtemp("/tmp/playwright-artifacts-");
	await mkdir(`${directory}/resources`);
	await writeFile(`${directory}/trace-test.trace`, "action\n");
	await writeFile(`${directory}/trace-test.network`, "network\n");
	await writeFile(`${directory}/resources/abc`, Uint8Array.of(0, 255));
	const state = {
		tracesDir: directory,
		traceFile: `${directory}/trace-test.trace`,
		networkFile: `${directory}/trace-test.network`,
		resourcesDir: `${directory}/resources`,
		traceSha1s: new Set(["abc"]),
		networkSha1s: new Set<string>(),
	};
	const native: {
		_state: typeof state | undefined;
		_fs: { syncAndGetError(): Promise<undefined> };
	} = {
		_state: state,
		_fs: {
			async syncAndGetError() {
				return undefined;
			},
		},
	};
	const tracing = { _connection: { toImpl: () => native } };
	const context = { tracing } as unknown as Parameters<
		// type-erasure-boundary -- This filesystem fixture supplies only the native tracing bridge consumed by the transport.
		typeof captureBrowserTrace
	>[0];
	return {
		directory,
		native,
		context,
		cleanup: () => rm(directory, { recursive: true, force: true }),
	};
}

describe("native browser trace transport", () => {
	test("flushes live native files and retains their paths for final capture after stop", async () => {
		const f = await fixture();
		try {
			const options = { signal: new AbortController().signal, maxBytes: 1024 };
			await writeFile(
				`${f.directory}/resources/page@native-123.45.jpeg`,
				Uint8Array.of(255, 216),
			);
			f.native._state!.traceSha1s.add("page@native-123.45.jpeg");
			const first = await captureBrowserTrace(f.context, options);
			expect(first.files.map((file) => file.path).sort()).toEqual([
				"resources/abc",
				"resources/page@native-123.45.jpeg",
				"trace-test.network",
				"trace-test.trace",
			]);
			expect([
				...first.files.find((file) => file.path === "resources/abc")!.bytes,
			]).toEqual([0, 255]);
			await writeFile(`${f.directory}/resources/other-session`, "private");
			expect(
				(await captureBrowserTrace(f.context, options)).files.some((file) =>
					file.path.includes("other-session"),
				),
			).toBe(false);
			f.native._state = undefined;
			await appendFile(`${f.directory}/trace-test.trace`, "final\n");
			const final = await captureBrowserTrace(f.context, options);
			expect(
				new TextDecoder().decode(
					final.files.find((file) => file.path.endsWith(".trace"))!.bytes,
				),
			).toBe("action\nfinal\n");
		} finally {
			await f.cleanup();
		}
	});

	test("rejects aggregate overflow, symlink resources and cancellation", async () => {
		const f = await fixture();
		try {
			const options = { signal: new AbortController().signal, maxBytes: 2 };
			await expect(captureBrowserTrace(f.context, options)).rejects.toThrow(
				"byte limit",
			);
			await symlink(
				`${f.directory}/trace-test.trace`,
				`${f.directory}/resources/escaped`,
			);
			f.native._state!.traceSha1s.add("escaped");
			await expect(
				captureBrowserTrace(f.context, { ...options, maxBytes: 1024 }),
			).rejects.toThrow("regular file");
			await expect(
				captureBrowserTrace(f.context, {
					...options,
					signal: AbortSignal.abort(new Error("cancelled")),
				}),
			).rejects.toThrow("cancelled");
			for (let index = 0; index < 1025; index++)
				f.native._state!.traceSha1s.add(`resource-${index}`);
			await expect(
				captureBrowserTrace(f.context, { ...options, maxBytes: 1024 }),
			).rejects.toThrow("file count limit");
			f.native._state!.tracesDir = "/etc";
			await expect(captureBrowserTrace(f.context, options)).rejects.toThrow(
				"Invalid native browser trace directory",
			);
		} finally {
			await f.cleanup();
		}
	});
});
