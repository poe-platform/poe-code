import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createPandocCommand} from "./command.js";
import {readDocument, writeDocument} from "./engine.js";

const paragraph = "Run jq filters against JSON in the virtual filesystem, including unary-minus\n" +
  "filters such as `jq -c '-.a'` without an extra `--`. `env` and `$ENV` expose the\n" +
  "Safe Bash command environment, never the host process environment.";
const lines = [
  "Run jq filters against JSON in the virtual filesystem, including unary-minus",
  "filters such as <code>jq -c '-.a'</code> without an extra <code>--</code>. <code>env</code> and <code>$ENV</code> expose the",
  "Safe Bash command environment, never the host process environment."
];

it.each(["none", undefined] as const)("honors HTML wrap=%s through the SDK and command", async wrap => {
  const expected = `<p>${lines.join(wrap === "none" ? " " : "\n")}</p>\n`;
  const bytes = new TextEncoder().encode(paragraph);
  const document = await readDocument({bytes}, {from: "markdown"}, {});
  expect(await writeDocument(document, {to: "html", ...(wrap ? {wrap} : {})}, {})).toMatchObject({kind: "text", text: expected});

  let stdout = "", stderr = "";
  const result = await createPandocCommand().execute({
    command: "pandoc", cwd: "/", env: {}, fs: new MemoryFileSystem(),
    args: ["-f", "markdown", "-t", "html", ...(wrap ? [`--wrap=${wrap}`] : [])],
    stdin: (async function* () {yield bytes;})(),
    signal: new AbortController().signal,
    stdout: {async write(chunk) {stdout += new TextDecoder().decode(chunk);}},
    stderr: {async write(chunk) {stderr += new TextDecoder().decode(chunk);}}
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).toBe(expected);
});

it("keeps hard breaks and code newlines with wrap=none", async () => {
  const document = await readDocument({bytes: new TextEncoder().encode("first  \nsecond\n\n    code\n    lines\n")}, {from: "markdown"}, {});
  expect(await writeDocument(document, {to: "html", wrap: "none"}, {})).toMatchObject({
    text: "<p>first<br>second</p>\n<pre><code>code\nlines</code></pre>\n"
  });
});

it.each(["auto", "preserve"] as const)("retains the unsupported HTML wrap=%s error", async wrap => {
  const document = await readDocument({bytes: new TextEncoder().encode(paragraph)}, {from: "markdown"}, {});
  await expect(writeDocument(document, {to: "html", wrap}, {})).rejects.toMatchObject({code: "E_OPTION"});
});
