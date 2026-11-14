import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments} from "safe-bash-contracts/command";
import {createPandocCommand} from "./command.js";
import {createStandalonePandocCommand} from "./safe-bash.js";
import fixtures from "./fixtures/reference-links.json" with {type: "json"};

function targets(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(targets);
  if (!value || typeof value !== "object") return [];
  const node = value as {t?: string; c?: unknown[]};
  return [...(["Link", "Image"].includes(node.t ?? "") ? [{kind: node.t, target: node.c!.at(-1)}] : []), ...Object.values(value).flatMap(targets)];
}

for (const mode of ["standalone", "command"] as const) {
  async function run(source: string, from = "markdown") {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input.md", new TextEncoder().encode(source));
    const args = ["-f", from, "-t", "json", "/input.md"];
    let stdout = "", stderr = "";
    const context = {cwd: "/", fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: {async write(bytes: Uint8Array) {stdout += new TextDecoder().decode(bytes);}},
      stderr: {async write(bytes: Uint8Array) {stderr += new TextDecoder().decode(bytes);}},
    };
    const result = mode === "command" ? await createPandocCommand().execute({...context, command: "pandoc", env: {}, args: createCommandArguments(args).args})
      : await createStandalonePandocCommand().execute({...context, args});
    expect(result.exitCode, stderr).toBe(0);
    return JSON.parse(stdout);
  }
  it.each(fixtures)(`${mode} preserves Markdown reference semantics: $name`, async fixture => {
    expect(targets(await run(fixture.source))).toEqual(fixture.targets);
  });
  it.each(["markdown", "markdown_strict", "markdown_phpextra", "markdown_mmd", "gfm", "commonmark", "commonmark_x"])(`${mode} uses %s duplicate precedence`, async from => {
    expect(targets(await run("[a][id]\n\n[id]: /first\n[id]: /second", from))).toEqual([
      {kind: "Link", target: [["gfm", "commonmark", "commonmark_x"].includes(from) ? "/first" : "/second", ""]},
    ]);
  });
}
