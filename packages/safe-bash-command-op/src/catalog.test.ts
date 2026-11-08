import assert from "node:assert/strict";
import { test } from "node:test";
import { opCatalogNodes, opCommandCatalog, opGlobalFlags } from "./catalog.js";
import { renderOpHelp } from "./help-renderer.js";
import { resolveOpCompletion } from "./completion-resolver.js";

test("all pinned native nodes share catalog metadata without adding dispatch leaves", () => {
  const native = opCatalogNodes.filter(node => node.availability === "stable");
  assert.equal(native.length, 97);
  assert.equal(opCommandCatalog.filter(node => node.availability === "stable").length, 76);
  const paths = new Set(native.map(node => node.path.join(" ")));
  assert.equal(paths.size, 97);
  for (const node of native) {
    assert.ok(node.summary, node.path.join(" "));
    assert.ok(node.description, node.path.join(" "));
    assert.ok(node.synopsis.endsWith("[flags]"), node.path.join(" "));
    for (const [name, flag] of Object.entries(node.flags)) assert.ok(flag.description, `${node.path.join(" ")} --${name}`);
    if (node.path.length) assert.ok(paths.has(node.path.slice(0, -1).join(" ")));
  }
});

test("item help presents native synopsis, selectors and local flags rather than generic placeholders", () => {
  const help = renderOpHelp(["item", "get"]);
  assert.ok(help.includes("Usage:  op item get [{ <itemName> | <itemID> | <shareLink> | - }] [flags]"));
  assert.ok(help.includes("--fields strings"));
  assert.ok(help.includes("Use 'label='"));
  assert.ok(help.includes("--fields type=concealed"));
  assert.ok(help.includes("To list the global flags"));
  assert.equal(help.includes("--account"), false);
  assert.equal(help.includes("[arguments]"), false);
});

test("native summaries and per-command force descriptions are shared with completion", () => {
  assert.deepEqual(resolveOpCompletion(["item", "g"]).candidates, [{ value: "get", description: "Get an item's details" }]);
  const descriptions = [
    [["read"], "Do not prompt for confirmation."],
    [["plugin", "clear"], "Apply immediately without asking for confirmation."],
    [["document", "get"], "Forcibly print an unintelligible document to an interactive terminal. If --out-file is specified, save the document to a file without prompting for confirmation."],
  ] as const;
  for (const [path, description] of descriptions) {
    assert.deepEqual(resolveOpCompletion([...path, "--force"]).candidates, [{ value: "--force", description }]);
    assert.ok(renderOpHelp(path).includes(description.slice(0, 40)));
  }
});

test("display defaults and metavars do not alter parser kinds or default request values", () => {
  assert.equal(opGlobalFlags.cache!.defaultDisplay, "true");
  assert.equal(opGlobalFlags.format!.defaultDisplay, '"human-readable"');
  assert.equal(Object.hasOwn(opGlobalFlags.cache!, "default"), false);
  const item = opCommandCatalog.find(node => node.path.join(" ") === "item create")!;
  assert.equal(item.flags["ssh-generate-key"]!.kind, "string");
  assert.equal(item.flags["ssh-generate-key"]!.metavar, "");
  assert.equal(item.flags["ssh-generate-key"]!.defaultDisplay, "Ed25519");
  const help = renderOpHelp(["item", "create"]);
  assert.ok(help.includes("--generate-password[=recipe]"));
  assert.ok(help.includes("(default Ed25519)"));
  assert.ok(renderOpHelp(["document", "get"]).includes("(default 0600)"));
});

test("verified argument bounds distinguish stdin alternatives from unknown constraints", () => {
  const find = (path: string) => opCommandCatalog.find(node => node.path.join(" ") === path)!;
  assert.deepEqual(find("read").args, { min: 1, max: 1 });
  assert.deepEqual(find("document get").args, { min: 1, max: 1 });
  assert.deepEqual(find("vault list").args, { min: 0, max: 0 });
  assert.deepEqual(find("whoami").args, { min: 0, max: 0 });
  assert.deepEqual(find("item template list").args, { min: 0, max: 0 });
  assert.deepEqual(find("item get").args, { min: 0, max: 1, stdinAlternative: true });
  assert.deepEqual(find("run").args, { min: 1 });
  assert.equal(find("item template get").args, undefined);
  assert.equal(find("group get").args, undefined);
  assert.ok(Object.isFrozen(find("item get").args));
});

test("help uses native sections and ordering while completion stays alphabetical", () => {
  const root = renderOpHelp([]);
  assert.ok(root.includes("Management Commands:"));
  assert.ok(root.includes("Global Flags:"));
  assert.ok(root.includes("--cache"));
  assert.deepEqual(resolveOpCompletion(["--ca"]).candidates.map(candidate => candidate.value), ["--cache"]);
  const item = renderOpHelp(["item"]);
  assert.ok(item.indexOf("  create") < item.indexOf("  get"));
  assert.ok(item.indexOf("  get") < item.indexOf("  edit"));
  assert.ok(item.indexOf("  edit") < item.indexOf("  delete"));
  assert.deepEqual(resolveOpCompletion(["item", ""]).candidates.map(candidate => candidate.value), ["create", "delete", "edit", "get", "list", "move", "share", "template"]);
  assert.equal(renderOpHelp(["item", "get"]).includes("--field "), false);
  assert.deepEqual(opCommandCatalog.find(node => node.path.join(" ") === "item get")!.flags.fields!.longAliases, ["field"]);
});
