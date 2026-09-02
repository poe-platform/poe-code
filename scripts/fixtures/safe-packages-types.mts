import { Budget, run, makeFsModule } from "@poe-platform/safe-js";
import { createMemoryFileSystem, type FileSystem } from "@poe-platform/safe-fs/core";
import type { FileSystem as CompatibilityFileSystem } from "@poe-platform/safe-js/fs";
import { Shell, standardCommands } from "@poe-platform/safe-bash";
import { createRealm, defineExtension, type HostObject } from "@poe-platform/safe-js/core";

const fs: FileSystem & CompatibilityFileSystem = createMemoryFileSystem();
const shell = new Shell({ fs, limits: { maxInputBytes: 100 } }).use(standardCommands());
await run("return 1;", { budget: new Budget({ maxSteps: 100 }) });
void makeFsModule;
await shell.dispose();
const extension = defineExtension({
  manifest: { version: 1, name: "typed-consumer", globals: ["node"] },
  setup(context) {
    const node: HostObject = context.createHostObject({ properties: { value: { get: () => 7 } } });
    return { globals: { node } };
  }
});
const realm = createRealm({ extensions: [extension], limits: { callbacks: 10 } });
await realm.evaluate("return node.value;");
await realm.close();
