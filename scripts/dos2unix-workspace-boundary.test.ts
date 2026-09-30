import { expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { build } from "esbuild";
import { createDos2unixCommand, createUnix2dosCommand, createDos2unixCommands, dos2unixCommands } from "safe-bash-command-dos2unix";
import { createCommandArguments, CommandArgumentIdentityError } from "safe-bash-contracts";
import { writeFileOutput, filesystemOutputBudgets } from "safe-bash-contracts/filesystem-output-budget";
import { yieldTurn } from "safe-bash-contracts/yield";
import { createManagedControlController } from "safe-bash-contracts/signals";
import { createDos2unixCommand as publicDos2unix, createUnix2dosCommand as publicUnix2dos, lineEndingCommands } from "../packages/safe-bash/src/commands/line-endings/index.js";
import { writeFileOutput as compatibleWrite } from "../packages/safe-bash/src/contracts/filesystem-output.js";
import { filesystemOutputBudgets as compatibleBudgets } from "../packages/safe-bash/src/contracts/filesystem-output-budget.js";
import { yieldTurn as compatibleYield } from "../packages/safe-bash/src/contracts/yield.js";
import { createManagedControlController as compatibleController } from "../packages/safe-bash/src/fs/creation-mask.js";
import { Shell } from "../packages/safe-bash/src/shell/index.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { builtInDirectContextExecutors } from "../packages/safe-bash/src/commands/internal.js";

it("retains factory exports when public browser entries share an external command runtime", async () => {
  const adapter = fileURLToPath(new URL("../packages/safe-bash/src/commands/line-endings/index.ts", import.meta.url));
  const runtime = { createDos2unixCommand, createUnix2dosCommand, createDos2unixCommands, dos2unixCommands };
  const outputs = await build({
    entryPoints: { commands: adapter, aggregate: "aggregate-fixture" },
    outdir: "/memory", bundle: true, splitting: true, write: false, format: "esm", platform: "browser",
    external: ["safe-bash-command-dos2unix"],
    plugins: [{ name: "aggregate-fixture", setup(builder) {
      builder.onResolve({ filter: /^aggregate-fixture$/ }, () => ({ path: "aggregate", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: `import * as api from ${JSON.stringify(adapter)}; export { api };`, resolveDir: path.dirname(adapter),
      }));
    } }],
  });
  const modules = new Map(outputs.outputFiles.map(output => [output.path, output.text]));
  const consumer = await build({
    stdin: {
      contents: `import { createDos2unixCommand, createUnix2dosCommand, createDos2unixCommands, dos2unixCommands, createLineEndingCommands, lineEndingCommands } from "/memory/commands.js";
import { api } from "/memory/aggregate.js";
export const names = [createDos2unixCommand().name, createUnix2dosCommand().name];
export const same = createDos2unixCommand === api.createDos2unixCommand && createUnix2dosCommand === api.createUnix2dosCommand && createDos2unixCommands === createLineEndingCommands && dos2unixCommands === lineEndingCommands;`,
      resolveDir: "/memory",
    },
    bundle: true, write: false, format: "cjs", platform: "browser", external: ["safe-bash-command-dos2unix"],
    plugins: [{ name: "memory-public-entries", setup(builder) {
      builder.onResolve({ filter: /^[./]/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: "memory" }));
      builder.onLoad({ filter: /.*/, namespace: "memory" }, args => ({
        contents: modules.get(args.path), resolveDir: path.dirname(args.path),
      }));
    } }],
  });
  const sandbox = createContext({ TextEncoder, TextDecoder, AbortController, AbortSignal, require(specifier: string) {
    expect(specifier).toBe("safe-bash-command-dos2unix");
    return runtime;
  } });
  const result = runInContext(`(() => { const module = { exports: {} }; ${consumer.outputFiles[0]!.text}; return module.exports; })()`, sandbox);
  expect(result).toEqual({ names: ["dos2unix", "unix2dos"], same: true });
});

it("shares the private implementation, diagnostics and file output accounting with Safe Bash", () => {
  for (const [facade, implementation] of [[publicDos2unix, createDos2unixCommand], [publicUnix2dos, createUnix2dosCommand]]) {
    const command = facade();
    expect(command.name).toBe(implementation().name);
    expect(builtInDirectContextExecutors.has(command.execute)).toBe(true);
    expect(builtInDirectContextExecutors.has(facade({ limits: { maxInputBytes: 1 } }).execute)).toBe(false);
  }
  expect(compatibleWrite).toBe(writeFileOutput);
  expect(compatibleBudgets).toBe(filesystemOutputBudgets);
  expect(compatibleYield).toBe(yieldTurn);
  expect(compatibleController).toBe(createManagedControlController);
});

it("runs both directions through saved scripts and pipes while preserving BOM paths and metadata", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/\ufeffinput", Uint8Array.of(239, 187, 191, 65, 13, 10, 66, 10), { mode: 0o640 });
  await fs.writeFile("/script.sh", new TextEncoder().encode('dos2unix -q -b -k "$1"; unix2dos -q -b -n "$1" /out; dos2unix -q -b -O /out | unix2dos -b\n'));
  const before = await fs.stat("/\ufeffinput");
  const shell = new Shell({ fs }).use(lineEndingCommands());
  try {
    const result = await shell.exec("sh /script.sh $'\\ufeffinput'");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect([...result.stdoutBytes]).toEqual([239, 187, 191, 65, 13, 10, 66, 13, 10]);
    expect([...await fs.readFile("/\ufeffinput")]).toEqual([239, 187, 191, 65, 10, 66, 10]);
    const after = await fs.stat("/\ufeffinput");
    expect(after.mode).toBe(before.mode);
    expect(after.mtimeMs).toBe(Math.floor(before.mtimeMs / 1000) * 1000);
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["out", "script.sh", "\ufeffinput"]);
    expect(() => shell.commands.register(createDos2unixCommand())).toThrow("already registered");
    shell.use(lineEndingCommands({ replace: true, limits: { maxInputBytes: 1 } }));
    expect(await shell.exec("dos2unix", { stdin: "AB" })).toMatchObject({ exitCode: 1, stderr: "dos2unix: input bytes limit exceeded\n" });
  } finally { await shell.dispose(); }
});

it("rejects invalid byte paths and preserves the canonical argument identity error", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/\ufffd", Uint8Array.of(65, 13, 10));
  const shell = new Shell({ fs }).use(lineEndingCommands());
  try {
    for (const byte of ["ff", "fe"]) {
      expect(await shell.exec(`dos2unix $'\\x${byte}'`)).toMatchObject({ exitCode: 1, stderr: "dos2unix: arguments must be valid UTF-8 paths\n" });
    }
    expect([...await fs.readFile("/\ufffd")]).toEqual([65, 13, 10]);
  } finally { await shell.dispose(); }
  const carrier = createCommandArguments([]);
  await expect(createDos2unixCommand().execute({
    command: "dos2unix", args: [], argumentValues: carrier, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() {} }, stderr: { async write() {} },
  })).rejects.toBeInstanceOf(CommandArgumentIdentityError);
});
