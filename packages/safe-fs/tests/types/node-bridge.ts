import type { Buffer } from "node:buffer";
import type { Stats } from "node:fs";
import type { createNodeFsBridge, NodeFsBridgeFileSystem, NodeFsImplementation } from "../../src/node/filesystem.js";

declare module "../../src/node/filesystem.js" {
  interface NodeFsBridgeFileSystem {
    readonly bridgeTypeTest?: "native";
  }
}

declare const bridge: ReturnType<typeof createNodeFsBridge>;
const bytes: Promise<Buffer<ArrayBuffer>> = bridge.readFile("/file");
const text: Promise<string> = bridge.readFile("/file", "utf8");
const stat: Promise<Stats> = bridge.stat("/file");
const implementation: NodeFsImplementation = bridge;
type Assert<Condition extends true> = Condition;
export type MergeableNativeInterface = Assert<NodeFsBridgeFileSystem["bridgeTypeTest"] extends "native" | undefined ? true : false>;
void [bytes, text, stat, implementation];
