import { CommandRegistry, pipeBytes, writeText } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import type { ShellOptions } from "../../src/shell/index.js";

export function setup(options: Partial<ShellOptions> = {}): { shell: Shell; fs: MemoryFileSystem; commands: CommandRegistry } {
  const fs = new MemoryFileSystem();
  const commands = new CommandRegistry([
    { name: "say", async execute({ args, stdout }) { await writeText(stdout, `${args.join(" ")}\n`); return { exitCode: 0 }; } },
    { name: "args", async execute({ args, stdout }) { await writeText(stdout, JSON.stringify(args)); return { exitCode: 0 }; } },
    { name: "pass", async execute({ stdin, stdout, signal }) { await pipeBytes(stdin, stdout, signal); return { exitCode: 0 }; } },
    { name: "err", async execute({ args, stderr }) { await writeText(stderr, `${args.join(" ")}\n`); return { exitCode: 0 }; } },
    { name: "both", async execute({ stdout, stderr }) { await writeText(stdout, "out\n"); await writeText(stderr, "err\n"); return { exitCode: 0 }; } },
    { name: "status", execute({ args }) { return { exitCode: Number(args[0] ?? 0) }; } },
    { name: "envget", async execute({ args, env, stdout }) { await writeText(stdout, args.map((name) => env[name] ?? "<unset>").join("|")); return { exitCode: 0 }; } },
    { name: "bytes", async execute({ stdout }) { await stdout.write(Uint8Array.from([0, 255, 195])); await stdout.write(Uint8Array.from([169, 128, 10])); return { exitCode: 0 }; } },
  ]);
  return { fs, commands, shell: new Shell({ fs, commands, ...options }) };
}
