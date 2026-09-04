import type { VirtualShellPlugin } from "../../contracts/index.js";
import { RegexExecutor } from "../regex-execution/portable.js";
import type { BoundedRegexProvider } from "../regex-execution/provider.js";
import type { RegexExecutionOptions } from "../regex-execution/protocol.js";
import { sedCommand } from "../text-programs/sed.js";
import type { TextProgramOptions } from "../text-programs/shared.js";
import { createGrepCommands } from "./grep.js";
import { createRgCommand } from "./rg-command.js";
import type { SearchOptions } from "./options.js";

export interface PortableSearchOptions {
  readonly provider: BoundedRegexProvider;
  readonly replace?: boolean;
  readonly regex?: RegexExecutionOptions;
  readonly search?: Omit<SearchOptions, "replace" | "regex">;
  readonly sed?: Omit<TextProgramOptions, "replace">;
}

export function portableSearchCommands(options: PortableSearchOptions): VirtualShellPlugin {
  const executor = new RegexExecutor(options.provider, options.regex);
  const commands = [...createGrepCommands(executor), createRgCommand(executor, options.search), sedCommand(options.sed)];
  return {
    name: "portable-search-commands",
    setup(host) {
      if (!options.replace) for (const command of commands) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    },
    dispose: () => executor.dispose(),
  };
}
