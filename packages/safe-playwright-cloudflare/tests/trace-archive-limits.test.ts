import { expect, test, vi } from "vitest";
import { Volume } from "memfs";
import { writeTraceArchive } from "../src/browser-trace-archive.js";
import type { FileSystem } from "@poe-code/safe-fs/core";

vi.mock("@poe-code/safe-fs/core", () => ({ dirname: () => "/output" }));
vi.mock("@poe-platform/safe-bash/playwright", () => ({ PlaywrightResourceLimitError: class extends Error {} }));
const writeZipArchive = vi.hoisted(() => vi.fn(async (_archive: unknown, _limits: unknown, _signal: AbortSignal) => new Uint8Array()));
vi.mock("@poe-code/office-package/zip", () => ({ createZipCodec: () => ({ writeZipArchive }) }));

test("trace export forwards unlimited codec metadata limits and selected resource quotas", async () => {
  const fs = new Volume().promises;
  await writeTraceArchive({ entries: [], calls: [], includeSources: false,
    fs: fs as unknown as FileSystem, zipFile: "/output/trace.zip",
    signal: new AbortController().signal, admitInput() {},
    limits: { maxArchiveBytes: 1000, maxBytes: 500, maxFiles: 3 },
  });
  expect(writeZipArchive.mock.calls[0]?.[1]).toMatchObject({
    maxArchiveBytes: 1000, maxEntryBytes: 500, maxTotalBytes: 500, maxMembers: 3,
    maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity,
  });
});
