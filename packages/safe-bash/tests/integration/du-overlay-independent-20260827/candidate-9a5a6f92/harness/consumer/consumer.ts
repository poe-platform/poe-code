import { Shell, createMemoryFileSystem, type VirtualShellPlugin } from "virtual-bash";
import {
  createDuCommand,
  createDuCommands,
  duCommands,
  type DuCommandsOptions,
} from "./node_modules/virtual-bash/dist/commands/du/index.js";

const options: DuCommandsOptions = { limits: { maxEntries: 64 } };
const command = createDuCommand(options);
const commands = createDuCommands(options);
const plugin: VirtualShellPlugin = duCommands(options);
const shell = new Shell({ fs: createMemoryFileSystem() }).use(plugin);
void [command, commands, shell];

