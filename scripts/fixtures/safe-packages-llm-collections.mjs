import { MemoryFileSystem } from "@poe-platform/safe-fs/core";
import { withLlmCollections } from "@poe-platform/safe-bash/commands/llm/collections";

export async function verifyLlmCollections() {
  const fs = new MemoryFileSystem();
  const options = { fs, path: "/embeddings.db", signal: new AbortController().signal,
    maxFileBytes: 1048576, maxIndexBytes: 1048576, maxOpenFiles: 8,
    now: () => new Date("2026-10-02T00:00:00Z") };
  const created = await withLlmCollections(options, async catalog => catalog.collection("documents", { model: "embed" }));
  if (!created.committed || created.cleanupErrors.length || created.value.model !== "embed") throw new Error("Collection creation failed");
  await withLlmCollections(options, async catalog => {
    const existing = await catalog.collection("documents", { create: false });
    if (existing.id !== created.value.id) throw new Error("Collection identity changed");
    let count = 0;
    await catalog.list(row => {
      if (row.name !== "documents" || row.count !== 0n) throw new Error("Unexpected collection row");
      count++;
    });
    if (count !== 1) throw new Error("Missing collection");
    await catalog.delete("documents");
  });
  await withLlmCollections(options, async catalog => {
    await catalog.list(() => { throw new Error("Deleted collection survived"); });
  });
  if ((await fs.readdir("/")).length !== 1) throw new Error("Collection scratch files leaked");
}
