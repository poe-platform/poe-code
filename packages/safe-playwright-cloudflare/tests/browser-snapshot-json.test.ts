import { expect, test, vi } from "vitest";
import type { PlaywrightPage } from "@poe-platform/safe-bash/playwright";
import { captureBrowserSnapshotJSON } from "../src/browser-snapshot-json";

test("rejects oversized frame trees before starting native snapshot work", async () => {
	const snapshot = vi.fn();
	const page = { frames: () => Array(129).fill({}), _snapshotForAI: snapshot };
	await expect(
		captureBrowserSnapshotJSON(page as unknown as PlaywrightPage, {
			signal: new AbortController().signal,
			timeoutMs: 15000,
			maxBytes: 1048576,
		}),
	).rejects.toThrow("Browser snapshot frame limit exceeded");
	expect(snapshot).not.toHaveBeenCalled();
});
