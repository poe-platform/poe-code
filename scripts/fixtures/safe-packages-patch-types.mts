import { Shell, createMemoryFileSystem, createPatchCommand as rootFactory } from "@poe-platform/safe-bash";
import { patchCommands, createPatchCommand, createPatchCommands, type PatchCommandsOptions, type PatchLimits } from "@poe-platform/safe-bash/commands/patch";
const limits: PatchLimits = { maxInputBytes: 1024, maxHunks: 2 };
const options: PatchCommandsOptions = { ...limits, replace: true };
const factory: typeof rootFactory = createPatchCommand;
const shell = new Shell({ fs: createMemoryFileSystem() }).use(patchCommands(options));
shell.register(factory(options));
createPatchCommands(options);
void shell.dispose();
