import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createMemoryFileSystem, createMountFileSystem, FsError } from "poe-code/safe-fs";
import { createYesCommand as sourceYesCommand } from "../../src/commands/yes/index.js";
import { CommandRegistry as SourceRegistry } from "../../src/contracts/command.js";
import { trapExtension as sourceTrapExtension } from "../../src/shell/extensions/trap/index.js";

type PublishedDefinition = import("poe-code/safe-bash").CommandDefinition;
type OptionalRuntime = {
  Shell: typeof import("poe-code/safe-bash").Shell;
  createYesCommand(): PublishedDefinition;
  createCmpCommand(): PublishedDefinition;
  createShufCommand(): PublishedDefinition;
  createTruncateCommand(): PublishedDefinition;
  createInstallCommand(): PublishedDefinition;
  createYqCommand(): PublishedDefinition;
  createDdCommand(): PublishedDefinition;
  yesCommands(): import("poe-code/safe-bash").VirtualShellPlugin;
  shufCommands(): import("poe-code/safe-bash").VirtualShellPlugin;
  truncateCommands(): import("poe-code/safe-bash").VirtualShellPlugin;
  cmpCommands(): import("poe-code/safe-bash").VirtualShellPlugin;
  installCommands(): import("poe-code/safe-bash").VirtualShellPlugin;
  yqCommands(): import("poe-code/safe-bash").VirtualShellPlugin;
  ddCommands(): import("poe-code/safe-bash").VirtualShellPlugin;
  createDeviceFileSystem(): import("poe-code/safe-fs").FileSystem;
  trapExtension(): NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
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
    for (const command of [optional.createYesCommand(), optional.createCmpCommand(), optional.createShufCommand(), optional.createTruncateCommand(), optional.createInstallCommand(), optional.createYqCommand()]) {
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

  test("public host refuses source-bound shell extensions before ASCII or raw actions execute", async () => {
    const { published } = await runtimes();
    type PublishedExtension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
    for (const source of ["trap 'printf ascii' EXIT", String.raw`action=$'printf "\377"'; trap "$action" EXIT`]) {
      const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [sourceTrapExtension() as unknown as PublishedExtension] }).use(published.agentCommands());
      try { await assert.rejects(shell.exec(source), /matching shell runtime/); }
      finally { await shell.dispose(); }
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
      'import { createInstallCommand, installCommands, type InstallCommandsOptions, type InstallModeRequest, type InstallContextRequest } from "../../dist/optional.js";',
      'import { createYqCommand, yqCommands, type YqCommandsOptions, type YqLimits } from "../../dist/optional.js";',
      'import { createDdCommand, ddCommands, type DdCommandsOptions, type DdFileOpener, type DdFileRequest, type DdFileHandle } from "../../dist/optional.js";',
      'import type { YesCommandOptions, YesCommandsOptions, CmpCommandsOptions, CmpLimits, ShufCommandsOptions, TruncateCommandsOptions, DeviceFileSystem } from "../../dist/optional.js";',
      'import { trapExtension, type TrapExtensionOptions, type TrapSignalHost, type ShellExtension } from "../../dist/optional.js";',
      'import { readExtension, type ReadExtensionOptions } from "../../dist/optional.js";',
      'import { jobsExtension, type PreparedShellChild, type ShellChildPreparation, type ShellListTerminatorContext, type ShellListTerminatorHook, type ShellSpecialParameterHook } from "../../dist/optional.js";',
      'import type { ShellBindingReference, ShellBindingResult, ShellExtensionContext, ShellExecutionCheckpoint } from "../../dist/optional.js";',
      'const yesOptions: YesCommandOptions = {}; const yesPluginOptions: YesCommandsOptions = {};',
      'const cmpOptions: CmpCommandsOptions = {}; const cmpLimits: Partial<CmpLimits> = {};',
      'const shufOptions: ShufCommandsOptions = {}; const truncateOptions: TruncateCommandsOptions = {};',
      'type Devices = DeviceFileSystem;',
      'const signalHost: TrapSignalHost = { subscribe(deliver, scope) { const accepted: boolean = deliver("USR1"); const owner: object = scope; return () => {}; } };',
      'const trapOptions: TrapExtensionOptions = { signalNames: { SIGUSR1: 30, SIGUSR2: 31 }, signalHost }; const trap: ShellExtension = trapExtension(trapOptions);',
      'const readOptions: ReadExtensionOptions = { nonTerminalInput: true }; const read: ShellExtension = readExtension(readOptions);',
      'const jobs: ShellExtension = jobsExtension();',
      'type JobsBridge = { child: PreparedShellChild; preparation: ShellChildPreparation; context: ShellListTerminatorContext; terminator: ShellListTerminatorHook; parameter: ShellSpecialParameterHook };',
      'type ReferenceBridge = { reference: ShellBindingReference; outcome: ShellBindingResult<ShellBindingReference>; prepare: ShellExtensionContext["bindings"]["prepareReference"] };',
      'type CheckpointBridge = { point: ShellExecutionCheckpoint; hook: NonNullable<ReturnType<ShellExtension["create"]>["checkpoint"]> };',
      'type PublicExtension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];',
      'type PublicCheckpoint = Parameters<NonNullable<ReturnType<PublicExtension["create"]>["checkpoint"]>>[0];',
      'const checkpointPoints: readonly ShellExecutionCheckpoint[] = ["loop-body-complete", "child-job-install", "source-input-read"]; const publicCheckpointPoints: readonly PublicCheckpoint[] = checkpointPoints;',
      'const indexedOperators: NonNullable<ShellExtension["syntax"]> = { indexedElementOperators: true }; const publicIndexedOperators: NonNullable<PublicExtension["syntax"]> = indexedOperators;',
      'type Assert<Condition extends true> = Condition; type OnlyOptIn = Assert<NonNullable<NonNullable<ShellExtension["syntax"]>["indexedElementOperators"]> extends true ? true : false>;',
      'const optionalWaitBridge: Pick<ShellExtensionContext, "interruptWait" | "waitInterruptibly"> = {};',
      'async function waitBridge(context: ShellExtensionContext): Promise<number | undefined> { const accepted: boolean | undefined = context.interruptWait?.(158); const outcome = await context.waitInterruptibly?.(async signal => { signal.throwIfAborted(); return { childStatus: 7 }; }); if (outcome?.kind === "completed") { const value: { childStatus: number } = outcome.value; return value.childStatus; } if (outcome?.kind === "interrupted") { const status: number = outcome.status; return status; } return undefined; }',
      'type PublicContext = Parameters<NonNullable<ReturnType<PublicExtension["create"]>["start"]>>[0]; const publicWaitBridge: Pick<PublicContext, "interruptWait" | "waitInterruptibly"> = optionalWaitBridge;',
      'new CommandRegistry([createYesCommand(), createShufCommand(), createTruncateCommand()]);',
      'new Shell({ fs: createMemoryFileSystem() }).use(yesCommands()).use(shufCommands()).use(truncateCommands());',
      'new Shell({ fs: createMemoryFileSystem(), extensions: [trap] });',
      'new Shell({ fs: createMemoryFileSystem(), extensions: [read] });',
      'new Shell({ fs: createMemoryFileSystem(), extensions: [jobs] });',
      'const installOptions: InstallCommandsOptions = { setMode(request: InstallModeRequest) {}, securityContext: { enabled: true, apply(request: InstallContextRequest) {} } };',
      'new CommandRegistry([createInstallCommand(installOptions)]);',
      'new Shell({ fs: createMemoryFileSystem() }).use(installCommands());',
      'const yqLimits: Partial<YqLimits> = { maxInputBytes: 1024 }; const yqOptions: YqCommandsOptions = { limits: yqLimits };',
      'new CommandRegistry([createYqCommand(yqOptions)]); new Shell({ fs: createMemoryFileSystem() }).use(yqCommands(yqOptions));',
      'const ddOptions: DdCommandsOptions = { maxBlockBytes: 1024 }; type DdHost = { open: DdFileOpener; request: DdFileRequest; handle: DdFileHandle };',
      'new CommandRegistry([createDdCommand(ddOptions)]); new Shell({ fs: createMemoryFileSystem() }).use(ddCommands(ddOptions));',
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

  test("public host shares counted descriptor output accounting and drains its retained handle", async () => {
    const { published } = await runtimes();
    const helpers = await import(new URL("../../dist/contracts/filesystem-descriptor.js", import.meta.url).href) as typeof import("../../src/contracts/filesystem-descriptor.js");
    const fs = createMemoryFileSystem();
    const open = fs.open.bind(fs);
    let writes = 0;
    let closes = 0;
    fs.open = async (...args) => {
      const descriptor = await open(...args);
      const write = descriptor.write.bind(descriptor);
      const close = descriptor.close.bind(descriptor);
      descriptor.write = (bytes, position, options) => {
        writes++;
        return write(bytes.subarray(0, 2), position, options);
      };
      descriptor.close = async () => { closes++; await close(); };
      return descriptor;
    };
    const shell = new published.Shell({ fs, limits: { maxOutputBytes: 4 } });
    shell.register({ name: "counted", runtimeIdentity: published.commandRuntimeIdentity, async execute(context) {
      await context.stdout.write(Uint8Array.of(120));
      const descriptor = await helpers.openCommandFile(context, "/out", { access: "write", creation: "exclusive" });
      const bytes = Uint8Array.of(255, 0, 66);
      assert.equal(await descriptor.write(bytes, null), 2);
      assert.equal(await descriptor.write(bytes.subarray(2), null), 1);
      await context.stdout.write(Uint8Array.of(121));
      return { exitCode: 0 };
    } });
    try {
      await assert.rejects(shell.exec("counted"), error => error instanceof published.ShellLimitError && error.limit === "maxOutputBytes");
      assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(255, 0, 66));
      assert.equal(writes, 2);
      assert.equal(closes, 1);
    } finally { await shell.dispose(); }
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

  for (const scripted of [false, true]) for (const pipefail of [false, true]) {
    test(`compiled device input drains early consumer cleanup: script=${scripted}, pipefail=${pipefail}`, async () => {
      const { published, optional } = await runtimes();
      const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": optional.createDeviceFileSystem() } });
      const shell = new published.Shell({ fs, limits: { maxWallClockMs: 2000 } }).use(published.agentCommands());
      const source = `${pipefail ? "set -o pipefail; " : ""}cat </dev/zero | head -c32`;
      try {
        if (scripted) await fs.writeFile("/pipe.sh", new TextEncoder().encode(source));
        const result = await shell.exec(scripted ? "bash /pipe.sh" : source);
        assert.equal(result.exitCode, pipefail ? 141 : 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.deepEqual(result.stdoutBytes, new Uint8Array(32));
      } finally { await shell.dispose(); }
    });
  }

  test("compiled opt-ins compose with existing date and byte tools in a real script", async () => {
    const { published, optional } = await runtimes();
    const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": optional.createDeviceFileSystem() } });
    const shell = new published.Shell({ fs, limits: { maxWallClockMs: 2000 } })
      .use(published.agentCommands()).use(optional.cmpCommands()).use(optional.shufCommands())
      .use(optional.truncateCommands()).use(optional.yesCommands());
    const script = [
      "set -e",
      "date -u -d @0 +%FT%TZ",
      "tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32 > /token",
      "wc -c < /token",
      "printf 'alpha\\nbeta\\ngamma\\n' > /choices",
      "shuf -n 1 /choices > /choice",
      "wc -l < /choice",
      "cp /token /copy",
      "cmp /token /copy",
      "truncate -s 40 /copy",
      "wc -c < /copy",
      "yes ok | head -n 2",
    ].join("\n");
    try {
      await fs.writeFile("/workflow.sh", new TextEncoder().encode(script));
      const result = await shell.exec("bash /workflow.sh");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "1970-01-01T00:00:00Z\n32\n1\n40\nok\nok\n");
      const token = await fs.readFile("/token");
      assert.equal(token.length, 32);
      assert.ok([...token].every(byte => byte >= 48 && byte <= 57 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122));
      const copy = await fs.readFile("/copy");
      assert.equal(copy.length, 40);
      assert.deepEqual(copy.subarray(0, 32), token);
      assert.deepEqual(copy.subarray(32), new Uint8Array(8));
      assert.ok(["alpha\n", "beta\n", "gamma\n"].includes(new TextDecoder().decode(await fs.readFile("/choice"))));
    } finally { await shell.dispose(); }
  });

  test("compiled trap retains byte-valued actions in the public host", async () => {
    const { published, optional } = await runtimes();
    const extension = optional.trapExtension();
    assert.equal(extension.runtimeIdentity, published.commandRuntimeIdentity);
    const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [extension] }).use(published.agentCommands());
    try {
      const result = await shell.exec(String.raw`action=$'printf "\377"'; trap "$action" EXIT`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, Uint8Array.of(255));
    } finally { await shell.dispose(); }
  });

  test("compiled install copies binary files and preserves explicit metadata through the public host", async () => {
    const { published, optional } = await runtimes();
    const fs = createMemoryFileSystem();
    const bytes = Uint8Array.of(255, 0, 128, 65);
    await fs.writeFile("/source", bytes);
    await fs.utimes("/source", 1000.75, 2000.5);
    const shell = new published.Shell({ fs }).use(optional.installCommands()).use(optional.cmpCommands());
    try {
      const result = await shell.exec("install -p -D -m 640 /source /nested/target && cmp /source /nested/target");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.deepEqual(await fs.readFile("/nested/target"), bytes);
      const stat = await fs.stat("/nested/target");
      assert.equal(stat.mode & 0o7777, 0o640);
      assert.equal(stat.mtimeMs, 2000.5);
    } finally { await shell.dispose(); }
  });

  test("compiled install respects the public host named-file output budget", async () => {
    const { published, optional } = await runtimes();
    const fs = createMemoryFileSystem();
    await fs.writeFile("/source", Uint8Array.of(1, 2, 3, 4));
    const shell = new published.Shell({ fs, limits: { maxOutputBytes: 2 } }).use(optional.installCommands());
    try {
      await assert.rejects(shell.exec("install /source /target"), error => error instanceof published.ShellLimitError && error.limit === "maxOutputBytes");
      const bytes = await fs.readFile("/target").catch(error => {
        if (error instanceof FsError && error.code === "ENOENT") return new Uint8Array();
        throw error;
      });
      assert.ok(bytes.byteLength <= 2);
    } finally { await shell.dispose(); }
  });

  for (const execution of ["standalone", "Shell"]) test(`compiled ${execution} install drains its buffered writer before rejecting cancellation`, { timeout: 2000 }, async () => {
    const { published, optional } = await runtimes();
    const base = createMemoryFileSystem();
    await base.writeFile("/source", Uint8Array.of(1, 2, 3, 4));
    let entered!: () => void;
    const writing = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const fs = new Proxy(base, { get(target, key) {
      if (key === "writeStream") return undefined;
      if (key === "writeFile") return async (...args: Parameters<typeof base.writeFile>) => {
        entered();
        await held;
        await base.writeFile(...args);
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const controller = new AbortController();
    const shell = execution === "Shell" ? new published.Shell({ fs }).use(optional.installCommands()) : undefined;
    let settled = false;
    const operation = Promise.resolve(shell ? shell.exec("install /source /target", { signal: controller.signal }) : optional.createInstallCommand().execute({
      command: "install", args: ["/source", "/target"], cwd: "/", env: {}, fs,
      signal: controller.signal, stdin: published.toByteSource(new Uint8Array()),
      stdout: { async write() {} }, stderr: { async write() {} },
    }));
    const checked = assert.rejects(operation, error => error === false);
    void operation.then(() => { settled = true; }, () => { settled = true; });
    try {
      await writing;
      controller.abort(false);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(settled, false, `${execution} completion must join its admitted writer`);
    } finally {
      release();
      await checked;
      await shell?.dispose();
    }
  });

  test("compiled trap preserves runtime affinity and separate actions when forking", async () => {
    const { published, optional } = await runtimes();
    const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [optional.trapExtension()] }).use(published.agentCommands());
    try {
      const result = await shell.exec("trap 'printf outer' EXIT; (trap 'printf child' EXIT; :); printf body");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "childbodyouter");
    } finally { await shell.dispose(); }
  });

  test("compiled yq edits a commented YAML file and emits native-profile JSON", async () => {
    const { published, optional } = await runtimes();
    const fs = createMemoryFileSystem();
    await fs.writeFile("/settings.yaml", Buffer.from("# config\nbuild:\n  enabled: false\n"));
    const shell = new published.Shell({ fs }).use(optional.yqCommands());
    try {
      const updated = await shell.exec("yq -i '.build.enabled = true' /settings.yaml");
      assert.equal(updated.exitCode, 0, updated.stderr);
      assert.equal(updated.stdout, "");
      assert.equal(updated.stderr, "");
      assert.equal(Buffer.from(await fs.readFile("/settings.yaml")).toString(), "# config\nbuild:\n  enabled: true\n");
      const queried = await shell.exec("yq -o=json -I=0 '.build' /settings.yaml");
      assert.equal(queried.exitCode, 0, queried.stderr);
      assert.equal(queried.stdout, '{"enabled":true}\n');
      assert.equal(queried.stderr, "");
      assert.deepEqual(await fs.readdir("/"), [{ name: "settings.yaml", type: "file" }]);
    } finally { await shell.dispose(); }
  });

  test("compiled yq refuses over-budget staging without changing the source or leaking a temporary file", async () => {
    const { published, optional } = await runtimes();
    const fs = createMemoryFileSystem();
    const original = Buffer.from("a: 1\n");
    await fs.writeFile("/settings.yaml", original);
    const shell = new published.Shell({ fs, limits: { maxOutputBytes: 2 } }).use(optional.yqCommands());
    try {
      await assert.rejects(shell.exec("yq -i '.a = 2' /settings.yaml"), error => error instanceof published.ShellLimitError && error.limit === "maxOutputBytes");
      assert.deepEqual(await fs.readFile("/settings.yaml"), new Uint8Array(original));
      assert.deepEqual(await fs.readdir("/"), [{ name: "settings.yaml", type: "file" }]);
    } finally { await shell.dispose(); }
  });

  test("compiled dd copies binary records into a retained named output", async () => {
    const { published, optional } = await runtimes();
    const fs = createMemoryFileSystem();
    const input = Uint8Array.of(255, 0, 128, 65, 66, 67, 68, 69);
    await fs.writeFile("/input", input);
    await fs.writeFile("/output", Buffer.from("abcdefgh"));
    const shell = new published.Shell({ fs }).use(optional.ddCommands());
    try {
      const definition = optional.createDdCommand();
      assert.equal(definition.runtimeIdentity, published.commandRuntimeIdentity);
      const result = await shell.exec("dd if=/input of=/output bs=2 count=3 conv=notrunc status=none");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.deepEqual(await fs.readFile("/output"), Uint8Array.of(255, 0, 128, 65, 66, 67, 103, 104));
      assert.deepEqual(await fs.readFile("/input"), input);
    } finally { await shell.dispose(); }
  });

  test("compiled dd streams explicitly mounted zero and random devices", async () => {
    const { published, optional } = await runtimes();
    const root = createMemoryFileSystem();
    const fs = createMountFileSystem({ root, mounts: { "/dev": optional.createDeviceFileSystem() } });
    const shell = new published.Shell({ fs }).use(published.agentCommands()).use(optional.ddCommands());
    try {
      const zero = await shell.exec("dd if=/dev/zero of=/zeros bs=4 count=2 status=none");
      assert.equal(zero.exitCode, 0, zero.stderr);
      assert.equal(zero.stderr, "");
      assert.deepEqual(await root.readFile("/zeros"), new Uint8Array(8));
      const random = await shell.exec("dd if=/dev/urandom bs=16 count=1 status=none | wc -c");
      assert.equal(random.exitCode, 0, random.stderr);
      assert.equal(random.stdout.trim(), "16");
      assert.equal(random.stderr, "");
    } finally { await shell.dispose(); }
  });

  test("compiled dd named writes share the public host output budget", async () => {
    const { published, optional } = await runtimes();
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("abcdefgh"));
    const shell = new published.Shell({ fs, limits: { maxOutputBytes: 3 } }).use(optional.ddCommands());
    try {
      await assert.rejects(shell.exec("dd if=/input of=/output bs=2 status=none"), error => error instanceof published.ShellLimitError && error.limit === "maxOutputBytes");
      assert.deepEqual(await fs.readFile("/output"), Uint8Array.of(97, 98));
    } finally { await shell.dispose(); }
  });

  for (const input of [Uint8Array.of(88, 89, 0, 0), Uint8Array.of(0, 0, 88, 89, 0, 0)]) {
    test(`compiled dd sparse append retains the actual cursor for ${input.length} input bytes`, async () => {
      const { published, optional } = await runtimes();
      const fs = createMemoryFileSystem();
      await fs.writeFile("/input", input);
      await fs.writeFile("/output", Buffer.from("abcdef"));
      const shell = new published.Shell({ fs }).use(optional.ddCommands());
      try {
        const result = await shell.exec("dd if=/input of=/output bs=2 seek=1 oflag=append conv=notrunc,sparse status=none");
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
        assert.deepEqual(await fs.readFile("/output"), Uint8Array.of(97, 98, 99, 100, 101, 102, 88, 89, 0, 0));
      } finally { await shell.dispose(); }
    });
  }
});
