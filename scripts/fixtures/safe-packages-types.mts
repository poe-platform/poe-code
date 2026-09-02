import { Budget, run, makeFsModule, type RunClock } from "@poe-platform/safe-js";
import { createMemoryFileSystem, type FileSystem } from "@poe-platform/safe-fs/core";
import type { FileSystem as CompatibilityFileSystem } from "@poe-platform/safe-js/fs";
import { Shell, standardCommands } from "@poe-platform/safe-bash";
import { createRealm, defineExtension, type HostObject, type GuestReference } from "@poe-platform/safe-js/core";

const fs: FileSystem & CompatibilityFileSystem = createMemoryFileSystem();
let next = 0;
const clock: RunClock = { now: () => next++, snapshot: () => ({ next }), restore: state => { next = state.next; } };
await run("return new Date(Date.now()).toISOString();", { clock });
const shell = new Shell({ fs, limits: { maxInputBytes: 100 } }).use(standardCommands());
await run("return 1;", { budget: new Budget({ maxSteps: 100 }) });
void makeFsModule;
await shell.dispose();
const extension = defineExtension({
  manifest: { version: 1, name: "typed-consumer", capabilities: ["guest:retain"], globals: ["node", "discard"] },
  setup(context) {
    const node: HostObject = context.createHostObject({ properties: { value: { get: () => 7 } } });
    const discard = context.retainGuestArguments((reference: GuestReference) => context.releaseGuestReference(reference), 0);
    return { globals: { node, discard } };
  }
});
const realm = createRealm({ extensions: [extension], grants: ["guest:retain"], clock, limits: { callbacks: 10, guestReferences: 10 } });
await realm.evaluate("discard({}); return node.value;");
await realm.close();
