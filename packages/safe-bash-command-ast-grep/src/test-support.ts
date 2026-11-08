import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts";
import {
  createAstGrepCommands,
  type AstGrepCommandsOptions
} from "./index.js";

export async function run(
  args: string[],
  files: Record<string, string> = {},
  stdin = "",
  options: AstGrepCommandsOptions = {},
  overrides: Partial<CommandContext> = {}
) {
  const fs = createMemoryFileSystem();
  for (const [path, text] of Object.entries(files)) {
    await fs.mkdir(path.slice(0, path.lastIndexOf("/")) || "/", { recursive: true });
    await fs.writeFile(path, new TextEncoder().encode(text));
  }
  let stdout = "",
    stderr = "";
  const result = await createAstGrepCommands(options).find(c => c.name === (overrides.command ?? "ast-grep"))!.execute({
    command: "ast-grep",
    args: createCommandArguments(args).args,
    cwd: "/",
    env: {},
    fs,
    stdin: (async function* () {
      yield new TextEncoder().encode(stdin);
    })(),
    stdout: {
      async write(bytes) {
        stdout += new TextDecoder().decode(bytes);
      }
    },
    stderr: {
      async write(bytes) {
        stderr += new TextDecoder().decode(bytes);
      }
    },
    signal: new AbortController().signal,
    ...overrides
  });
  return { ...result, stdout, stderr, fs };
}
