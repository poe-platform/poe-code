import { Budget, run, makeFsModule, type RunClock, type HostObjectIndexedDefinition, type HostObjectNamedDefinition } from "@poe-platform/safe-js";
import { createMemoryFileSystem, type FileSystem } from "@poe-platform/safe-fs/core";
import type { FileSystem as CompatibilityFileSystem } from "@poe-platform/safe-js/fs";
import { Shell, standardCommands } from "@poe-platform/safe-bash";
import { createRealm, defineExtension, type HostObject, type GuestReference, type HostObjectIndexedDefinition as CoreIndexed, type HostObjectNamedDefinition as CoreNamed } from "@poe-platform/safe-js/core";

const fs: FileSystem & CompatibilityFileSystem = createMemoryFileSystem();
let next = 0;
const clock: RunClock = { now: () => next++, snapshot: () => ({ next }), restore: state => { next = state.next; } };
await run("return new Date(Date.now()).toISOString();", { clock });
const shell = new Shell({ fs, limits: { maxInputBytes: 100 } }).use(standardCommands());
await run("return 1;", { budget: new Budget({ maxSteps: 100 }) });
void makeFsModule;
await shell.dispose();
const extension = defineExtension({
  manifest: { version: 1, name: "typed-consumer", capabilities: ["guest:retain"], globals: ["node", "discard", "nodes"] },
  setup(context) {
    const node: HostObject = context.createHostObject({ properties: { value: { get: () => 7 } } });
    const indexed: HostObjectIndexedDefinition & CoreIndexed = { length: () => 1, get: () => node, maxLength: 8 };
    const named: HostObjectNamedDefinition & CoreNamed = { keys: () => ["node"], get: () => node, maxKeys: 8, maxKeyCodeUnits: 128, enumerable: false };
    const nodes = context.createHostObject({ indexed, named });
    const discard = context.retainGuestArguments((reference: GuestReference) => context.releaseGuestReference(reference), 0);
    return { globals: { node, discard, nodes } };
  }
});
const realm = createRealm({ extensions: [extension], grants: ["guest:retain"], clock, limits: { callbacks: 10, guestReferences: 10 } });
await realm.evaluate("discard({}); return [node.value, nodes[0] === node, nodes.node === node];");
await realm.close();
