import {readFileSync} from "node:fs";
import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createPandocCommand} from "./command.js";

const fixtures = JSON.parse(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/pandoc-lua-filters.json", import.meta.url), "utf8")) as {id: string; flags: string[]; script: string; status: number}[];

it.each(fixtures)("preserves TypeScript Lua behavior: $id", async fixture => {
  const fs = new MemoryFileSystem();
  const encode = (text: string) => new TextEncoder().encode(text);
  await fs.writeFile("/a.md", encode("a"));
  await fs.writeFile("/upper.lua", encode(fixture.script));
  for (const output of [[], ["-o", "/saved"]]) {
    await fs.writeFile("/saved", encode("KEEP"));
    let stdout = "", stderr = "";
    const result = await createPandocCommand().execute({
      command: "pandoc", args: ["-f", "markdown", "-t", "plain", "/a.md", ...output, ...fixture.flags],
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}},
      stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
    });
    expect(result.exitCode, stderr).toBe(fixture.status);
    expect(stdout).toBe(fixture.status === 0 && output.length === 0 ? "A\n" : "");
    expect(new TextDecoder().decode(await fs.readFile("/saved"))).toBe(fixture.status === 0 && output.length > 0 ? "A\n" : "KEEP");
  }
});
