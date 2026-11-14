import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments} from "safe-bash-contracts/command";
import {createPandocCommand} from "./command.js";
import {createStandalonePandocCommand} from "./safe-bash.js";

for (const mode of ["standalone", "command"] as const) {
  async function run(a: string, b: string, operands: string[], flag: string[], to = "plain", stdin = "") {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/a.md", new TextEncoder().encode(a)); await fs.writeFile("/b.md", new TextEncoder().encode(b)); await fs.writeFile("/out.txt", new TextEncoder().encode("KEEP"));
    const args = ["-f", "markdown", "-t", to, ...operands, ...flag];
    let stdout = "", stderr = "";
    const context = {cwd: "/", fs, signal: new AbortController().signal,
      stdin: (async function* () {yield new TextEncoder().encode(stdin);})(),
      stdout: {async write(bytes: Uint8Array) {stdout += new TextDecoder().decode(bytes);}},
      stderr: {async write(bytes: Uint8Array) {stderr += new TextDecoder().decode(bytes);}},
    };
    const result = mode === "command" ? await createPandocCommand().execute({...context, command: "pandoc", env: {}, args: createCommandArguments(args).args})
      : await createStandalonePandocCommand().execute({...context, args});
    return {...result, stdout, stderr, fs};
  }
  for (const flag of [[], ["--file-scope"]]) {
    it.each([
      ["a", "b", "a\n\nb\n"], ["a\n", "b\n", "a\n\nb\n"],
      ["a\r\n", "b\r\n", "a\n\nb\n"], ["", "b", "b\n"],
      ["a", "", "a\n"], ["# A", "# B", "A\n\nB\n"],
    ])(`${mode} ${flag.join(" ")} preserves operand boundaries: %j %j`, async (a, b, expected) => {
      expect(await run(a, b, ["/a.md", "/b.md"], flag)).toMatchObject({exitCode: 0, stdout: expected, stderr: ""});
    });
    it(`${mode} ${flag.join(" ")} preserves stdin ordering and single inputs`, async () => {
      for (const [operands, expected] of [
        [["/a.md", "-", "/b.md"], "a\n\ns\n\nb\n"], [["-", "/a.md"], "s\n\na\n"], [["/a.md"], "a\n"],
      ] as const) {
        expect(await run("a", "b", [...operands], flag, "plain", "s")).toMatchObject({exitCode: 0, stdout: expected, stderr: ""});
      }
      const result = await run("a", "b", ["/a.md", "/missing.md", "-o", "/out.txt"], flag);
      expect(result.exitCode).not.toBe(0);
      expect(await result.fs.readFile("/out.txt")).toEqual(new TextEncoder().encode("KEEP"));
    });
    it(`${mode} ${flag.join(" ")} uses the correct list scope`, async () => {
      const result = await run("- a", "- b", ["/a.md", "/b.md"], flag, "json");
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).blocks.filter((block: {t: string}) => block.t === "BulletList")).toHaveLength(flag.length ? 2 : 1);
    });
  }
}
