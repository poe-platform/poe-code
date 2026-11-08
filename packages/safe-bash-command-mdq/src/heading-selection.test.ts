import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { toByteSource } from "safe-bash-contracts/io";
import type { CommandContext } from "safe-bash-contracts/command";
import { createMdqCommand, mdq } from "./index.js";

for (const kind of ["link", "image"] as const) {
  const prefix = kind === "image" ? "!" : "";
  const heading = `${prefix}[heading](/heading)`;
  const paragraph = `${prefix}[body](/body)`;
  const selector = `${prefix}[]()`;
  const cases = [
    { name: "level one heading", stdin: `# ${heading}\n`, query: selector, found: false },
    { name: "level two heading", stdin: `## ${heading}\n`, query: selector, found: false },
    { name: "paragraph", stdin: `${paragraph}\n`, query: selector, found: true },
    { name: "nested headings", stdin: `# Outer ${heading}\n\n## Inner ${heading}\n`, query: selector, found: false },
    { name: "nested paragraph", stdin: `# Outer ${heading}\n\n## Inner ${heading}\n\n${paragraph}\n`, query: selector, found: true },
    { name: "selected section heading", stdin: `# Outer ${heading}\n\n## Inner ${heading}\n`, query: `# Outer | ${selector}`, found: false },
    { name: "selected nested section body", stdin: `# Outer ${heading}\n\n## Inner ${heading}\n\n${paragraph}\n`, query: `# Outer | # Inner | ${selector}`, found: true },
    { name: "selected paragraph", stdin: `# ${heading}\n\n${paragraph}\n`, query: `P: | ${selector}`, found: true }
  ];
  for (const fixture of cases) for (const format of ["markdown", "json"]) for (const api of ["command", "sdk"]) {
    test(`${kind} selection in ${fixture.name} (${format}, ${api})`, async () => {
      let stdout = "", stderr = "";
      const argv = ["-o", format, "--link-format", "inline", fixture.query];
      const context: CommandContext = {
        command: "mdq", args: argv, cwd: "/", env: {}, fs: createMemoryFileSystem(),
        signal: new AbortController().signal,
        stdin: toByteSource(new TextEncoder().encode(fixture.stdin)),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      };
      const result = await (api === "command" ? createMdqCommand().execute(context) : mdq(context, { argv }));
      assert.equal(stdout, format === "json"
        ? JSON.stringify({ items: fixture.found ? [{ [kind]: kind === "link" ? { display: "body", url: "/body" } : { alt: "body", url: "/body" } }] : [] })
        : fixture.found ? paragraph : "");
      assert.equal(stderr, "");
      assert.equal(result.exitCode, fixture.found ? 0 : 1);
    });
  }
}
