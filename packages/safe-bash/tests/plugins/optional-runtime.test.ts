import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createMemoryFileSystem } from "poe-code/safe-fs";
import { createYesCommand as sourceYesCommand } from "../../src/commands/yes/index.js";
import { CommandRegistry as SourceRegistry } from "../../src/contracts/command.js";

type PublishedDefinition = import("poe-code/safe-bash").CommandDefinition;
type OptionalRuntime = {
  Shell: typeof import("poe-code/safe-bash").Shell;
  createYesCommand(): PublishedDefinition;
  createCmpCommand(): PublishedDefinition;
  createShufCommand(): PublishedDefinition;
  createTruncateCommand(): PublishedDefinition;
  yesCommands(): import("poe-code/safe-bash").VirtualShellPlugin;
  shufCommands(): import("poe-code/safe-bash").VirtualShellPlugin;
  truncateCommands(): import("poe-code/safe-bash").VirtualShellPlugin;
};

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("explicit coherent optional build", { skip: selected === undefined ? "Requires build:optional and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  async function runtimes() {
    const published = await import("poe-code/safe-bash");
    const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as OptionalRuntime;
    return { published, optional };
  }

  test("optional factories and public host share the actual contract instance", async () => {
    const { published, optional } = await runtimes();
    assert.equal(optional.Shell, published.Shell);
    for (const command of [optional.createYesCommand(), optional.createCmpCommand(), optional.createShufCommand(), optional.createTruncateCommand()]) {
      assert.equal(command.runtimeIdentity, published.commandRuntimeIdentity);
      assert.equal(new published.CommandRegistry([command]).has(command.name), true);
    }
  });

  test("coherent binary arguments and short-consumer cleanup work through the public host", async () => {
    const { published, optional } = await runtimes();
    const shell = new published.Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 1000 } }).use(published.agentCommands()).use(optional.yesCommands());
    try {
      const result = await shell.exec("yes $'\\377' | head -c 3");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 10, 255));
    } finally { await shell.dispose(); }
  });

  test("mixed source factories are refused before replacing a public-host command", async () => {
    const { published, optional } = await runtimes();
    const registry = new published.CommandRegistry([optional.createYesCommand()]);
    const previous = registry.get("yes");
    assert.throws(() => registry.register(sourceYesCommand() as unknown as PublishedDefinition, { replace: true }), /matching shell runtime/);
    assert.equal(registry.get("yes"), previous);
  });

  test("public host refuses a foreign registry before it can accept source-bound commands", async () => {
    const { published } = await runtimes();
    for (const registry of [new SourceRegistry(), new SourceRegistry([sourceYesCommand()])]) {
      assert.throws(() => new published.Shell({
        fs: createMemoryFileSystem(),
        commands: registry as unknown as import("poe-code/safe-bash").CommandRegistry,
      }), /matching shell runtime/);
    }
  });

  test("coherent named-output helpers share the public budget and settle cleanup", async () => {
    const { published } = await runtimes();
    const helpers = await import(new URL("../../dist/contracts/filesystem-output.js", import.meta.url).href) as typeof import("../../src/contracts/filesystem-output.js");
    const fs = createMemoryFileSystem();
    await fs.writeFile("/out", Uint8Array.of(9));
    const writeStream = fs.writeStream!.bind(fs);
    let active = 0;
    fs.writeStream = async (...args) => {
      active++;
      try { await writeStream(...args); }
      finally { active--; }
    };
    const shell = new published.Shell({ fs, limits: { maxOutputBytes: 1 } });
    shell.register({
      name: "named-output", runtimeIdentity: published.commandRuntimeIdentity,
      async execute(context) {
        const output = await helpers.openFileOutput(context, "/out", "w");
        try {
          await output.sink.write(Uint8Array.of(1, 2, 3, 4));
          await output.finish();
          return { exitCode: 0 };
        } catch (error) { await output.abort(error); throw error; }
      },
    });
    try {
      await assert.rejects(shell.exec("named-output"), error => error instanceof published.ShellLimitError && error.limit === "maxOutputBytes");
      assert.ok((await fs.readFile("/out")).length <= 1);
      assert.equal(active, 0);
    } finally { await shell.dispose(); }
  });

  test("actual optional declarations typecheck against the published host without duplicate brands", () => {
    const filename = fileURLToPath(new URL("./optional-consumer.ts", import.meta.url));
    const source = [
      'import { Shell, CommandRegistry } from "poe-code/safe-bash";',
      'import { createMemoryFileSystem } from "poe-code/safe-fs";',
      'import { createYesCommand, yesCommands, createShufCommand, shufCommands } from "../../dist/optional.js";',
      'import { createTruncateCommand, truncateCommands } from "../../dist/optional.js";',
      'new CommandRegistry([createYesCommand(), createShufCommand(), createTruncateCommand()]);',
      'new Shell({ fs: createMemoryFileSystem() }).use(yesCommands()).use(shufCommands()).use(truncateCommands());',
    ].join("\n");
    const options: ts.CompilerOptions = {
      noEmit: true, strict: true, exactOptionalPropertyTypes: true,
      target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, types: ["node"],
    };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, languageVersion, ...rest) => path === filename
      ? ts.createSourceFile(path, source, languageVersion, true) : original(path, languageVersion, ...rest);
    const program = ts.createProgram([filename], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.deepEqual(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
  });

  test("compiled shuf preserves raw binary operands through the public host", async () => {
    const { published, optional } = await runtimes();
    const shell = new published.Shell({ fs: createMemoryFileSystem() }).use(optional.shufCommands());
    try {
      const result = await shell.exec("shuf -e $'\\377'");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 10));
    } finally { await shell.dispose(); }
  });

  test("compiled shuf named output cannot escape the public host budget", async () => {
    const { published, optional } = await runtimes();
    const fs = createMemoryFileSystem();
    const shell = new published.Shell({ fs, limits: { maxOutputBytes: 1 } }).use(optional.shufCommands());
    try {
      await assert.rejects(shell.exec("shuf -e abc -o /out"), error => error instanceof published.ShellLimitError && error.limit === "maxOutputBytes");
      assert.ok((await fs.readFile("/out")).length <= 1);
    } finally { await shell.dispose(); }
  });

  test("compiled truncate receives preferred I/O metadata through the public filesystem", async () => {
    const { published, optional } = await runtimes();
    const fs = createMemoryFileSystem();
    const shell = new published.Shell({ fs }).use(optional.truncateCommands());
    try {
      const result = await shell.exec("truncate -o -s 1 /blocks");
      assert.equal(result.exitCode, 0, result.stderr);
      const stat = await fs.stat("/blocks");
      assert.equal(stat.ioBlockSize, 65536);
      assert.equal(stat.size, stat.ioBlockSize);
    } finally { await shell.dispose(); }
  });

  test("compiled truncate preserves raw arguments without aliasing decoded filenames", async () => {
    const { published, optional } = await runtimes();
    const fs = createMemoryFileSystem();
    await fs.writeFile("/\ufffd", Uint8Array.of(1, 2, 3));
    const shell = new published.Shell({ fs }).use(optional.truncateCommands());
    try {
      const diagnostic = await shell.exec("truncate -s $'\\377' /out");
      assert.equal(diagnostic.exitCode, 1);
      assert.deepEqual(Buffer.from(diagnostic.stderrBytes), Buffer.from("truncate: Invalid number: '\\377'\n"));
      const filename = await shell.exec("truncate -s 0 $'\\377'");
      assert.equal(filename.exitCode, 1);
      assert.deepEqual(await fs.readFile("/\ufffd"), Uint8Array.of(1, 2, 3));
    } finally { await shell.dispose(); }
  });
});
