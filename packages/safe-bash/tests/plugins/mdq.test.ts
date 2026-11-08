import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createAgentCommands, createMemoryFileSystem, createMdqCommand, createMdqCommands, mdq, mdqCommand, mdqCommands, type MdqRunOptions } from "../../src/index.js";
import * as subpath from "../../src/commands/mdq/index.js";

test("mdq extracts nested chapters through VFS redirects and shell pipelines", async t => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  t.after(() => shell.dispose());
  await fs.writeFile("/SPEC.md", new TextEncoder().encode("# Authentication\n\nUse a token.\n\n## Token expiry\n\nExpires after an hour.\n\n# Other\n\nUnrelated.\n"));
  const chapter = await shell.exec("mdq '# Authentication' < /SPEC.md");
  assert.equal(chapter.exitCode, 0, chapter.stderr);
  assert.equal(chapter.stdout, "# Authentication\n\nUse a token.\n\n## Token expiry\n\nExpires after an hour.\n");
  const nested = await shell.exec("mdq '# Authentication | # Token expiry' < /SPEC.md");
  assert.equal(nested.exitCode, 0, nested.stderr);
  assert.equal(nested.stdout, "## Token expiry\n\nExpires after an hour.\n");
  const pipeline = await shell.exec("cat /SPEC.md | mdq -o json '# Token expiry' | jq -r '.items[0].section.title'");
  assert.equal(pipeline.exitCode, 0, pipeline.stderr);
  assert.equal(pipeline.stdout, "Token expiry\n");
});

test("mdq root and command entry share the SDK and registration identities", async t => {
  assert.equal(mdq, subpath.mdq);
  assert.equal(createMdqCommand, subpath.createMdqCommand);
  assert.equal(createMdqCommands, subpath.createMdqCommands);
  assert.deepEqual(createMdqCommands().map(command => command.name), ["mdq"]);
  assert.equal(mdqCommand, subpath.mdqCommand);
  assert.equal(mdqCommands, subpath.mdqCommands);
  assert.deepEqual(createAgentCommands().filter(command => command.name === "mdq").map(command => command.name), ["mdq"]);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(mdqCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec("mdq '# Title'", { stdin: "# Title\n\nBody.\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "# Title\n\nBody.\n");
  assert.deepEqual(shell.commands.list().map(command => command.name), ["mdq"]);
});

test("saved mdq script queries positional VFS files and writes JSON for a downstream command", async t => {
  const fs = createMemoryFileSystem(), encode = (value: string): Uint8Array => new TextEncoder().encode(value);
  await fs.mkdir("/work");
  const input = encode("# Authentication\n\nUse a token.\n\n## Token expiry\n\nExpires after an hour.\n\n# Other\n\nUnrelated.\n");
  const script = encode("mdq '# Authentication' < \"$1\" > authentication.md || exit \"$?\"\nmdq -o json '# Authentication | # Token expiry' \"$1\" > \"$2\" || exit \"$?\"\njq -r '.items[0].section.title' \"$2\"\n");
  await fs.writeFile("/work/SPEC.md", input);
  await fs.writeFile("/work/extract.sh", script);
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec("sh extract.sh SPEC.md expiry.json");
  assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { exitCode: 0, stdout: "Token expiry\n", stderr: "" });
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/authentication.md")), "# Authentication\n\nUse a token.\n\n## Token expiry\n\nExpires after an hour.\n");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(await fs.readFile("/work/expiry.json"))), { items: [{ section: { depth: 2, title: "Token expiry", body: [{ paragraph: "Expires after an hour." }] } }] });
  assert.deepEqual(await fs.readFile("/work/SPEC.md"), input);
  assert.deepEqual(await fs.readFile("/work/extract.sh"), script);
});

const referencedMarkdown = '# One\n\nRead [the API](https://example.test/api "API").[^note]\n\n# Two\n\nRead [guide][g].\n\n[g]: https://example.test/guide\n\n[^note]: Important.\n';
// Additional byte expectations captured with the pinned native mdq v0.10.0 oracle.
const sdkCases: readonly { options: MdqRunOptions; cli: string; expected: string; status?: number; input?: string }[] = [
  { options: { selectors: "# Authentication | # Token expiry", files: ["/SPEC.md"] }, cli: "mdq '# Authentication | # Token expiry' /SPEC.md", expected: "## Token expiry\n\nExpires after an hour.\n" },
  { options: { selectors: "# Token expiry", output: "json" }, cli: "mdq -o json '# Token expiry'", expected: '{"items":[{"section":{"depth":2,"title":"Token expiry","body":[{"paragraph":"Expires after an hour."}]}}]}' },
  { options: { selectors: "# Token expiry", output: "plain", breaks: false, wrapWidth: 80 }, cli: "mdq -o plain --no-br --wrap-width 80 '# Token expiry'", expected: "Token expiry\nExpires after an hour.\n" },
  { options: { selectors: "# Token expiry", output: "md", breaks: true, linkFormat: "inline", linkPos: "doc", footnotePos: "section", renumberFootnotes: false, allowUnknownMarkdown: true }, cli: "mdq -o md --br -l inline --link-pos doc --footnote-pos section --renumber-footnotes false --allow-unknown-markdown '# Token expiry'", expected: "## Token expiry\n\nExpires after an hour.\n" },
  { options: { selectors: "# Missing", quiet: true }, cli: "mdq -q '# Missing'", expected: "", status: 1 },
  { options: { argv: ["--output", "plain", "# Token expiry"] }, cli: "mdq --output plain '# Token expiry'", expected: "Token expiry\nExpires after an hour.\n" },
  { options: { selectors: "", linkFormat: "inline", linkPos: "doc", footnotePos: "doc", renumberFootnotes: false }, cli: "mdq --link-format inline --link-pos doc --footnote-pos doc --renumber-footnotes false ''", input: referencedMarkdown, expected: '# One\n\nRead [the API](https://example.test/api "API").[^note]\n\n# Two\n\nRead [guide](https://example.test/guide).\n\n[^note]: Important.\n' },
  { options: { selectors: "", linkFormat: "keep", linkPos: "section", footnotePos: "section", renumberFootnotes: true }, cli: "mdq --link-format keep --link-pos section --footnote-pos section --renumber-footnotes true ''", input: referencedMarkdown, expected: '# One\n\nRead [the API](https://example.test/api "API").[^1]\n\n[^1]: Important.\n\n# Two\n\nRead [guide][g].\n\n[g]: https://example.test/guide\n' },
  { options: { selectors: "", linkFormat: "never-inline", linkPos: "doc", footnotePos: "section" }, cli: "mdq --link-format never-inline --link-pos doc --footnote-pos section ''", input: referencedMarkdown, expected: '# One\n\nRead [the API][1].[^1]\n\n[^1]: Important.\n\n# Two\n\nRead [guide][g].\n\n[1]: https://example.test/api "API"\n[g]: https://example.test/guide\n' },
  { options: { selectors: "P:", wrapWidth: 12 }, cli: "mdq --wrap-width 12 'P:'", input: referencedMarkdown, expected: 'Read\n[the API][1].[^1]\n\n[1]: https://example.test/api "API"\n[^1]:\n  Important.\n\n   -----\n\nRead\n[guide][g].\n\n[g]: https://example.test/guide\n' },
];

for (const [index, fixture] of sdkCases.entries()) test(`typed mdq SDK matches CLI results through the Shell context ${index + 1}`, async t => {
  const fs = createMemoryFileSystem(), input = fixture.input ?? "# Authentication\n\nUse a token.\n\n## Token expiry\n\nExpires after an hour.\n";
  await fs.writeFile("/SPEC.md", new TextEncoder().encode(input));
  const shell = new Shell({ fs }).use(agentCommands());
  shell.commands.register({ name: "sdk-mdq", execute: context => mdq(context, fixture.options) });
  t.after(() => shell.dispose());
  for (const command of [fixture.cli, "sdk-mdq"]) {
    const result = await shell.exec(command, { stdin: input });
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { exitCode: fixture.status ?? 0, stdout: fixture.expected, stderr: "" });
  }
});

test("agentCommands forwards mdq limits while keeping the aggregate replacement policy", async t => {
  const options = { limits: { inputBytes: 2 } };
  Object.defineProperty(options, "replace", { enumerable: true, get() { throw new Error("Unexpected nested replacement"); } });
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ mdq: options }));
  t.after(() => shell.dispose());
  const result = await shell.exec("mdq", { stdin: "# Heading\n" });
  assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { exitCode: 1, stdout: "", stderr: "mdq: inputBytes limit exceeded\n" });
});
