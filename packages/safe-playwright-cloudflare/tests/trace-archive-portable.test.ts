import { expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createZipCodec } from "@poe-code/office-package/zip";
import { writeTraceArchive } from "../src/browser-trace-archive.js";
import { validateTraceLimits } from "../src/browser-trace-budget.js";

test("exports trace files, stacks and SHA-1 source names through portable filesystem APIs without Buffer", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/trace");
  await fs.writeFile("/trace/events", new TextEncoder().encode('{"type":"event"}\n'));
  const source = "/trace/文.ts";
  await fs.writeFile(source, new TextEncoder().encode("export const café = 1;"));
  const hash = createHash("sha1").update(source).digest("hex");
  const admitted: string[] = [];
  vi.stubGlobal("Buffer", undefined);
  try {
    await writeTraceArchive({ fs, entries: [{ name: "trace.trace", value: "/trace/events" }],
      zipFile: "/output/archive.zip", calls: [{ id: 1, stack: [{ file: source }] }],
      includeSources: true, limits: validateTraceLimits({}), signal: new AbortController().signal,
      admitInput(path) { admitted.push(path); },
    });
    const archive = await createZipCodec().readZipArchive(await fs.readFile("/output/archive.zip"), {
      ...validateTraceLimits({}), maxEntryBytes: Infinity, maxTotalBytes: Infinity, maxMembers: Infinity,
      maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 65536,
    }, new AbortController().signal);
    expect(archive.entries.map(entry => entry.name)).toEqual(["trace.trace", "trace.stacks", `resources/src@${hash}.txt`]);
    expect(admitted).toEqual(["/trace/events", source]);
  } finally { vi.unstubAllGlobals(); }
});
