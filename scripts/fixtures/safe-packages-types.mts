import { Budget, run, makeFsModule } from "@poe-platform/safe-js";
import { createMemoryFileSystem, type FileSystem } from "@poe-platform/safe-fs/core";
import type { FileSystem as CompatibilityFileSystem } from "@poe-platform/safe-js/fs";
import { Shell, standardCommands } from "@poe-platform/safe-bash";

const fs: FileSystem & CompatibilityFileSystem = createMemoryFileSystem();
const shell = new Shell({ fs, limits: { maxInputBytes: 100 } }).use(standardCommands());
await run("return 1;", { budget: new Budget({ maxSteps: 100 }) });
void makeFsModule;
await shell.dispose();
