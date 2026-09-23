import assert from "node:assert/strict";
import test from "node:test";
import {Budget, declareHostOperation, makeFsModule, run} from "@poe-code/safe-js";
import {nodeCommands} from "../../src/commands/node/index.js";
import {createPandocCommand, pandocCommands} from "../../src/commands/pandoc/index.js";
import {fixture} from "./pandoc-fixture.js";

const runtime = {run, makeFsModule, declareHostOperation, createBudget: (options: ConstructorParameters<typeof Budget>[0]) => new Budget(options)};

test("pandoc executes ordered local JSON filters in the selected virtual interpreter", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/first.cjs", 'const ast = JSON.parse(await process.stdin.readText()); ast.blocks[0].c[0].c = process.argv[2] + ":" + ast.blocks[0].c[0].c.toUpperCase(); console.log(JSON.stringify(ast));');
  volume.writeFileSync("/work/-second.cjs", 'const ast = JSON.parse(await process.stdin.readText()); ast.blocks[0].c[0].c += ":SECOND"; console.log(JSON.stringify(ast));');
  shell.use(nodeCommands({runtime})).use(pandocCommands({replace: true, jsonFilterCommand: "node"}));
  try {
    const result = await shell.exec("pandoc -fcommonmark -thtml -Ffirst.cjs -F./-second.cjs b.md");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "<p>html:BETA:SECOND</p>\n");
  } finally {await shell.dispose();}
});

test("virtual interpreter errors leave Pandoc's output destination unchanged", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/broken.cjs", 'throw new Error("broken filter");');
  shell.use(nodeCommands({runtime})).use(pandocCommands({replace: true, jsonFilterCommand: "node"}));
  try {
    const result = await shell.exec("pandoc -fcommonmark -thtml -Fbroken.cjs b.md -oout");
    assert.equal(result.exitCode, 9, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
  } finally {await shell.dispose();}
});

test("a JSON interpreter does not admit Lua or citeproc", async () => {
  const {shell} = fixture();
  shell.use(pandocCommands({replace: true, jsonFilterCommand: "node"}));
  try {
    for (const flag of ["-Lmissing.lua", "-C"]) {
      const result = await shell.exec(`pandoc -fcommonmark -thtml ${flag} b.md`);
      assert.equal(result.exitCode, 3, result.stderr);
      assert.equal(result.stdout, "");
    }
  } finally {await shell.dispose();}
});

test("Pandoc rejects ambiguous filter configuration and invalid interpreter names", () => {
  assert.throws(() => pandocCommands({jsonFilterCommand: "node", filters: {apply: async document => document}}), TypeError);
  for (const name of ["", "node --eval", "../node", "node\0"]) {
    assert.throws(() => pandocCommands({jsonFilterCommand: name}), TypeError);
  }
});

test("invalid JSON from a local filter cannot replace the destination", async () => {
  const {shell, volume} = fixture();
  volume.writeFileSync("/work/invalid.cjs", 'console.log("{}");');
  shell.use(nodeCommands({runtime})).use(pandocCommands({replace: true, jsonFilterCommand: "node"}));
  try {
    const result = await shell.exec("pandoc -fcommonmark -thtml -Finvalid.cjs b.md -oout");
    assert.equal(result.exitCode, 4, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
  } finally {await shell.dispose();}
});

test("filter invocation forwards cancellation and awaits interpreter cleanup", async () => {
  const {shell, volume} = fixture();
  const controller = new AbortController();
  let cleaned = false;
  shell.commands.register({name: "owned-interpreter", async execute(context) {
    assert.deepEqual(context.args, ["--", "/work/filter with spaces.cjs", "html"]);
    context.registerCleanup?.(() => {cleaned = true;});
    controller.abort();
    context.signal.throwIfAborted();
    return {exitCode: 0};
  }});
  shell.use(pandocCommands({replace: true, jsonFilterCommand: "owned-interpreter"}));
  try {
    await assert.rejects(shell.exec("pandoc -fcommonmark -thtml -F'filter with spaces.cjs' b.md -oout", {signal: controller.signal}), {name: "AbortError"});
    assert.equal(volume.readFileSync("/work/out", "utf8"), "Keep");
    assert.equal(cleaned, true);
  } finally {await shell.dispose();}
});

test("closing Pandoc stdout cancels its filter interpreter", async () => {
  const {fs, shell} = fixture();
  const consumer = new AbortController();
  let interpreterCancelled = false;
  const write = async () => {};
  try {
    await assert.rejects(async () => createPandocCommand({jsonFilterCommand: "node"}).execute({
      command: "pandoc", args: ["-fcommonmark", "-thtml", "-Ffilter.cjs"],
      cwd: "/work", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {yield new TextEncoder().encode("Hello");})(),
      stdout: {write, ownedOutput: {consumerClosed: consumer.signal, write}}, stderr: {write},
      invoke: async (_command, _args, options) => {
        consumer.abort(new Error("consumer closed"));
        interpreterCancelled = options?.signal?.aborted === true;
        return {exitCode: 1};
      }
    }), {message: "consumer closed"});
    assert.equal(interpreterCancelled, true);
  } finally {await shell.dispose();}
});
