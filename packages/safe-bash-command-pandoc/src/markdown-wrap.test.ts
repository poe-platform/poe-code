import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createPandocCommand, readDocument, writeDocument} from "./index.js";

it.each(["gfm", "commonmark"])("honors %s wrapping through the public command and SDK writer", async to => {
  const source = "first\nsecond *nested\ntext*\\\nhard\n\n```\ncode\nlines\n```\n";
  const bytes = new TextEncoder().encode(source);
  const document = await readDocument({bytes}, {from: "markdown"}, {});
  for (const wrap of ["none", "preserve"] as const) {
    const expected = wrap === "none"
      ? "first second *nested text*\\\nhard\n\n```\ncode\nlines\n```\n"
      : source;
    expect(await writeDocument(document, {to, wrap, columns: 5}, {})).toMatchObject({kind: "text", text: expected});
    let stdout = "", stderr = "";
    const result = await createPandocCommand().execute({
      command: "pandoc", cwd: "/", env: {}, fs: new MemoryFileSystem(),
      args: ["-f", "markdown", "-t", to, `--wrap=${wrap}`, "--columns=5"],
      stdin: (async function* () {yield bytes;})(),
      signal: new AbortController().signal,
      stdout: {async write(chunk) {stdout += new TextDecoder().decode(chunk);}},
      stderr: {async write(chunk) {stderr += new TextDecoder().decode(chunk);}}
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected);
  }
});
