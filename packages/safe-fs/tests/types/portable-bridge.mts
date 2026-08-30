import { createFsBridge, MemoryFileSystem, type FsBridgeCodec } from "../../src/core.js";

declare const codec: FsBridgeCodec;
const bridge = createFsBridge(new MemoryFileSystem(), { codec });
const bytes: Promise<Uint8Array> = bridge.readFile("/file");
const text: Promise<string> = bridge.readFile("/file", "utf8");
const name: Promise<Uint8Array> = bridge.readlink("/link", "buffer");
type Assert<Condition extends true> = Condition;
export type NoBufferMethods = Assert<"readUInt32LE" extends keyof Awaited<typeof bytes> ? false : true>;
export type CodecRequired = Assert<{ cwd: string } extends Parameters<typeof createFsBridge>[1] ? false : true>;
void [bytes, text, name];
