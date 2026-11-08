import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { builtInDirectContextExecutors, syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
import { createPandocCommand } from "./index.js";

it("registers standalone pandoc executors without bypassing custom limits", () => {
  expect(builtInDirectContextExecutors.has(createPandocCommand().execute)).toBe(true);
  expect(builtInDirectContextExecutors.has(createPandocCommand({ limits: { inputBytes: 1 } }).execute)).toBe(false);
  expect(syncCommandEvaluators.evalSyncPandoc?.(undefined, ["--list-input-formats"])).toContain("markdown");
});

it("converts markdown with the default standalone VFS adapter", async () => {
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  const result = await createPandocCommand({}).execute({
    command: "pandoc", args: ["-f", "markdown", "-t", "html"], cwd: "/", env: {},
    fs: new MemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () { yield new TextEncoder().encode("hello"); })(),
    stdout: { write: async bytes => { output.push(bytes); } },
    stderr: { write: async bytes => { errors.push(bytes); } }
  });
  expect(result).toEqual({ exitCode: 0 });
  expect(errors).toEqual([]);
  expect(new TextDecoder().decode(Buffer.concat(output))).toBe("<p>hello</p>\n");
});

it("publishes -o output on filesystems with trustedOwnedStaging", async () => {
  const backing = new MemoryFileSystem();
  await backing.writeFile("/input.md", new TextEncoder().encode("# Hello\n"));
  const fs = new Proxy(backing, {
    get(target, prop, receiver) {
      if (prop === "capabilities") {
        return { ...target.capabilities, atomicFileMutation: false, trustedOwnedStaging: true };
      }
      if (prop === "capabilitiesFor") {
        return async () => ({ ...target.capabilities, atomicFileMutation: false, trustedOwnedStaging: true });
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    }
  });
  const errors: Uint8Array[] = [];
  const result = await createPandocCommand({}).execute({
    command: "pandoc", args: ["/input.md", "-o", "/output.html"], cwd: "/", env: {},
    fs, signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { write: async () => {} },
    stderr: { write: async bytes => { errors.push(bytes); } }
  });
  expect(result).toEqual({ exitCode: 0 });
  expect(errors).toEqual([]);
  expect(new TextDecoder().decode(await backing.readFile("/output.html"))).toBe("<h1 id=\"hello\">Hello</h1>\n");
});
