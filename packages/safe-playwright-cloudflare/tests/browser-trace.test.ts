import { vi, beforeEach } from "vitest";
import { vol } from "memfs";
vi.mock("node:fs", async () => (await import("memfs")).fs);
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
import { RealFileSystem } from "@poe-code/safe-fs/fs/real";
import type { FileStat } from "@poe-code/safe-fs/core";
import { captureBrowserTrace } from "../src/browser-trace";
const fs = new RealFileSystem({ root: "/" });

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
			const first = await captureBrowserTrace(f.context, options, fs);
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
				(await captureBrowserTrace(f.context, options, fs)).files.some((file) =>
					file.path.includes("other-session"),
				),
			).toBe(false);
			f.native._state = undefined;
			await appendFile(`${f.directory}/trace-test.trace`, "final\n");
			const final = await captureBrowserTrace(f.context, options, fs);
			expect(
				new TextDecoder().decode(
					final.files.find((file) => file.path.endsWith(".trace"))!.bytes,
				),
			).toBe("action\nfinal\n");
		} finally {
			await f.cleanup();
		}
	});

	test.each([2048, Infinity])("captures more than 1024 owned resources with byte budget %s", async (maxBytes) => {
		const f = await fixture();
		try {
			for (let index = 0; index < 1025; index++) {
				const name = `resource-${index}`;
				vol.writeFileSync(`${f.directory}/resources/${name}`, "x");
				f.native._state!.traceSha1s.add(name);
			}
			const result = await captureBrowserTrace(f.context, {
				signal: new AbortController().signal, maxBytes,
			}, fs);
			expect(result.files).toHaveLength(1028);
			await expect(captureBrowserTrace(f.context, {
				signal: new AbortController().signal, maxBytes: 1024,
			}, fs)).rejects.toThrow("byte limit");
		} finally { await f.cleanup(); }
	});

	test("accepts owned resource names beyond the former path ceiling", async () => {
		const f = await fixture();
		try {
			const name = "a".repeat(257);
			vol.writeFileSync(`${f.directory}/resources/${name}`, "x");
			f.native._state!.traceSha1s.add(name);
			const result = await captureBrowserTrace(f.context, {
				signal: new AbortController().signal, maxBytes: 1024,
			}, fs);
			expect(result.files.map(file => file.path)).toContain(`resources/${name}`);
		} finally { await f.cleanup(); }
	});

	test("rejects aggregate overflow, symlink resources and cancellation", async () => {
		const f = await fixture();
		try {
			const options = { signal: new AbortController().signal, maxBytes: 2 };
			await expect(captureBrowserTrace(f.context, options, fs)).rejects.toThrow(
				"byte limit",
			);
			await symlink(
				`${f.directory}/trace-test.trace`,
				`${f.directory}/resources/escaped`,
			);
			f.native._state!.traceSha1s.add("escaped");
			await expect(
				captureBrowserTrace(f.context, { ...options, maxBytes: 1024 }, fs),
			).rejects.toThrow("regular file");
			await expect(
				captureBrowserTrace(f.context, {
					...options,
					signal: AbortSignal.abort(new Error("cancelled")),
				}, fs),
			).rejects.toThrow("cancelled");
			f.native._state!.tracesDir = "/etc";
			await expect(captureBrowserTrace(f.context, options, fs)).rejects.toThrow(
				"Invalid native browser trace directory",
			);
		} finally {
			await f.cleanup();
		}
	});
});

for (const metadataMode of ["absent", "placeholder"] as const) {
  for (const side of ["both", "retained"] as const) {
    test(`live trace rejects ${metadataMode} ${side} identity without reading substituted bytes`, async () => {
      const f = await fixture();
      const filesystem = new RealFileSystem({ root: "/" });
      const hideIdentity = (stat: FileStat): FileStat => {
        const { identityScope: ignoredScope, ino: ignoredIno, dev: ignoredDev, ...metadata } = stat;
        return metadataMode === "absent" ? metadata : { ...metadata, identityScope: Symbol.for("virtual-bash.fs.native"), ino: 0, dev: 0 };
      };
      const read = vi.fn();
      const close = vi.fn();
      if (side === "both") vi.spyOn(filesystem, "lstat").mockImplementation(async (path, options) => hideIdentity(await fs.lstat(path, options)));
      vi.spyOn(filesystem, "openReadFile").mockImplementation(async (path, options) => {
        const handle = await fs.openReadFile(path, options);
        return {
          ...handle,
          stat: async options => hideIdentity(await handle.stat(options)),
          read: async (...args) => { read(); return handle.read(...args); },
          close: async () => { close(); await handle.close(); },
        };
      });
      try {
        await expect(captureBrowserTrace(f.context, { signal: new AbortController().signal, maxBytes: 1024 }, filesystem))
          .rejects.toThrow("identity unavailable");
        expect(read).not.toHaveBeenCalled();
        if (side === "retained") expect(close).toHaveBeenCalledOnce();
      } finally { await f.cleanup(); }
    });
  }
}
