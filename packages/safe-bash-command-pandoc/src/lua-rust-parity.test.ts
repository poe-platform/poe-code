import {readFileSync} from "node:fs";
import {dirname} from "node:path";
import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createPandocCommand} from "./command.js";

const fixtures = JSON.parse(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/pandoc-lua-filters.json", import.meta.url), "utf8")) as {id: string; flags: string[]; script: string | number[]; path?: string; cwd?: string; status: number; bufferedStatus?: number; stdout?: string; bufferedStdout?: string; stderr?: string; bufferedStderr?: string}[];

it.each(fixtures)("preserves TypeScript Lua behavior: $id", async fixture => {
  const fs = new MemoryFileSystem();
  const encode = (text: string) => new TextEncoder().encode(text);
  const path = fixture.path ?? "/upper.lua", cwd = fixture.cwd ?? "/";
  await fs.mkdir(dirname(path), {recursive: true});
  await fs.mkdir(cwd, {recursive: true});
  await fs.writeFile("/a.md", encode("a"));
  await fs.writeFile(path, typeof fixture.script === "string" ? encode(fixture.script) : Uint8Array.from(fixture.script));
  for (const output of [[], ["-o", "/saved"]]) {
    await fs.writeFile("/saved", encode("KEEP"));
    let stdout = "", stderr = "";
    const result = await createPandocCommand().execute({
      command: "pandoc", args: ["-f", "markdown", "-t", "plain", "/a.md", ...output, ...fixture.flags],
      cwd, env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}},
      stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
    });
    const status = (output.length > 0 ? fixture.bufferedStatus : undefined) ?? fixture.status;
    expect(result.exitCode, stderr).toBe(status);
    expect(stderr).toBe((output.length > 0 ? fixture.bufferedStderr : undefined) ?? fixture.stderr ?? "");
    expect(stdout).toBe(status === 0 && output.length === 0 ? (fixture.stdout ?? "A\n") : "");
    expect(new TextDecoder().decode(await fs.readFile("/saved"))).toBe(status === 0 && output.length > 0 ? (fixture.bufferedStdout ?? fixture.stdout ?? "A\n") : "KEEP");
  }
});
