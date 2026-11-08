import {
  Shell,
  createAgentCommands,
  createMemoryFileSystem,
  createOverlayFileSystem,
  type CommandDefinition,
} from "virtual-bash";
import { createDuCommand } from "./node_modules/virtual-bash/dist/commands/du/index.js";

const lower = createMemoryFileSystem();
const upper = createMemoryFileSystem();
const overlay = createOverlayFileSystem({ upper, lower });
const command: CommandDefinition = createDuCommand();
const shell = new Shell({ fs: overlay });
shell.register(command);
const aggregate: readonly CommandDefinition[] = createAgentCommands();
void aggregate;
await shell.dispose();
