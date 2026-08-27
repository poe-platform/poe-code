import assert from "node:assert/strict";

const mode = process.argv[2] ?? "positive";

async function expectedRejection(operation) {
  try {
    await operation();
  } catch (error) {
    process.stderr.write(`CONTROL_REJECTION ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 23;
    return;
  }
  throw new Error(`control ${mode} unexpectedly resolved`);
}

if (mode === "wrong-package") {
  await expectedRejection(() => import("virtual-bash"));
} else if (mode === "outside-source") {
  await expectedRejection(() => import(process.env.OUTSIDE_SOURCE_URL));
} else if (mode === "wrong-hash") {
  await expectedRejection(() => import("virtual-bash"));
} else if (mode === "positive") {
  const rootUrl = import.meta.resolve("virtual-bash");
  const treeUrl = import.meta.resolve("virtual-bash/commands/tree");
  const root = await import("virtual-bash");
  const tree = await import("virtual-bash/commands/tree");
  const definitions = root.createAgentCommands();
  assert.equal(definitions.length, 70);
  assert.equal(definitions.filter(command => command.name === "tree").length, 1);
  assert.equal(typeof tree.createTreeCommand, "function");
  const fs = root.createMemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array());
  const shell = new root.Shell({ fs, env: { TREE_CHARSET: "UTF8" } }).use(root.agentCommands());
  const result = await shell.exec("tree --noreport");
  await shell.dispose();
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, ".\n└── file\n");
  assert.equal(result.stderr, "");
  process.stdout.write(`${JSON.stringify({
    pass: true,
    registryCount: definitions.length,
    treeCount: 1,
    rootUrl,
    treeUrl,
    treeStdout: result.stdout,
  }, null, 2)}\n`);
} else {
  throw new Error(`unknown mode: ${mode}`);
}
