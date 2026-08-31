import type { FileSystem, NodeFsBridgeOptions } from "poe-code/safe-fs";

export { createNodeFsBridge } from "poe-code/safe-fs";
export type { NodeFsBridgeFileSystem, NodeFsBridgeOptions, NodeFsImplementation as SafeJsFsImplementation } from "poe-code/safe-fs";

export function makeSafeJsFsModule<Module>(
  makeFsModule: (options: { adapter: FileSystem } & NodeFsBridgeOptions) => Module,
  fs: FileSystem,
  options: NodeFsBridgeOptions = {},
): Module {
  return makeFsModule({ adapter: fs, ...options });
}
