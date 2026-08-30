import { standardCommands } from "../../../../src/commands/index.js";
import type { ShellOptions } from "../../../../src/shell/types.js";
import { setup } from "../../helpers.js";

export function runtimeSetup(options: Partial<ShellOptions> = {}) {
  const result = setup(options);
  result.shell.use(standardCommands());
  return result;
}
