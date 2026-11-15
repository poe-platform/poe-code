import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments} from "safe-bash-contracts/command";
import {createPandocCommand} from "./command.js";
import {createStandalonePandocCommand} from "./safe-bash.js";
import fixtures from "./fixtures/code-spans.json" with {type: "json"};

for (const mode of ["standalone", "command"] as const) {
  async function run(source: string, to = "json") {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input.md", new TextEncoder().encode(source));
    const args = ["-f", "markdown", "-t", to, "/input.md"];
    let stdout = "", stderr = "";
    const context = {cwd: "/", fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: {async write(bytes: Uint8Array) {stdout += new TextDecoder().decode(bytes);}},
      stderr: {async write(bytes: Uint8Array) {stderr += new TextDecoder().decode(bytes);}},
    };
    const result = mode === "command" ? await createPandocCommand().execute({...context, command: "pandoc", env: {}, args: createCommandArguments(args).args})
      : await createStandalonePandocCommand().execute({...context, args});
    expect(result.exitCode, stderr).toBe(0);
    return stdout;
  }
  it.each(fixtures)(`${mode} preserves code spans: $name`, async fixture => {
    expect(JSON.parse(await run(fixture.source)).blocks).toEqual(fixture.blocks);
    expect(await run(fixture.source, "html")).toBe(fixture.html);
    expect(await run(fixture.source, "plain")).toBe(fixture.plain);
  });
}
