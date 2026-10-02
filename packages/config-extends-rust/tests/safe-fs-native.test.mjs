import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import * as own from "../dist/index.js";
import * as sdk from "../../config-extends/dist/index.js";

test("SafeFS base discovery decodes UTF-8 and strips its BOM", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/bases");
  await fs.writeFile("/bases/job.yaml", new TextEncoder().encode("\ufefftitle: café"));
  const result = await own.findBase("job", ["/bases"], fs);
  assert.deepEqual(result, { filePath: "/bases/job.yaml", content: "title: café" });
  assert.deepEqual(result, await sdk.findBase("job", ["/bases"], fs));
});

test("SafeFS inherited documents preserve prompts and metadata", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/bases");
  await fs.writeFile("/bases/job.md", new TextEncoder().encode("---\ntitle: café\n---\nBase {{name}}"));
  const chain = [
    { source: "document", filePath: "/work/job.md", content: "---\nextends: true\n---\nDoc({{yield}})" },
    { source: "base", path: "/bases" },
  ];
  const options = { fs, view: { name: "世界" } };
  const result = await own.resolve(chain, options);
  assert.equal(result.data.prompt, "Doc(Base 世界)");
  assert.equal(result.data.title, "café");
  assert.deepEqual(result, await sdk.resolve(chain, options));
});

test("SafeFS prompt documents use rooted realpath and byte reads", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/job.md", new TextEncoder().encode("---\ntitle: café\n---\nHello {{name}}"));
  const input = { cwd: "/work", filePath: "job.md", fs, variables: { name: "世界" } };
  const result = await own.resolvePromptDocument(input);
  assert.equal(result.prompt, "Hello 世界");
  assert.equal(result.metadata.title, "café");
  assert.deepEqual(result, await sdk.resolvePromptDocument(input));
});
