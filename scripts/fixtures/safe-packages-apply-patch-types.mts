import { Shell, createMemoryFileSystem, createApplyPatchCommand as rootFactory } from "@poe-platform/safe-bash";
import { applyPatchCommands, createApplyPatchCommand, createApplyPatchCommands, type ApplyPatchCommandsOptions, type ApplyPatchLimits } from "@poe-platform/safe-bash/commands/apply-patch";
const limits: Partial<ApplyPatchLimits> = { maxPatchBytes: 1024, maxFiles: 2 };
const options: ApplyPatchCommandsOptions = { limits, replace: true };
const factory: typeof rootFactory = createApplyPatchCommand;
const shell = new Shell({ fs: createMemoryFileSystem() }).use(applyPatchCommands(options));
shell.register(factory(options));
createApplyPatchCommands(options);
void shell.dispose();
