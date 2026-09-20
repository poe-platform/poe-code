import {
  createServer,
  defineSchema,
  Image,
  Audio,
  File,
  fileTypeFromBuffer,
  parseUriTemplate,
  validateProtocolValue,
  type HandlerRequestContext
} from "../src/index.js";
import { PassThrough } from "node:stream";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const server = createServer({ name: "typed", version: "1", validateToolArguments: true });
const imageType: "image" = Image.fromBytes(new Uint8Array(), "png").toContentBlock().type;
const audioType: "audio" = Audio.fromBase64("", "audio/wav").toContentBlock().type;
const resourceType: "resource" = File.fromText("Hello").toContentBlock().type;
const detected: string | undefined = fileTypeFromBuffer(new Uint8Array())?.mime;
void [imageType, audioType, resourceType, detected];
const remoteImage: Promise<Image> = Image.fromUrl("https://example.test/image", { maxBytes: 1024 });
const remoteAudio: Promise<Audio> = Audio.fromUrl("https://example.test/audio");
const remoteFile: Promise<File> = File.fromUrl("https://example.test/file");
void [remoteImage, remoteAudio, remoteFile];
server.tool("inferred", "Typed schema", defineSchema({
  name: { type: "string" }, count: { type: "integer", optional: true }
}), args => {
  const name: string = args.name;
  const count: number | undefined = args.count;
  // @ts-expect-error schema inference keeps strings distinct from numbers
  const invalid: number = args.name;
  void invalid;
  return { value: name + count };
}, defineSchema({ value: { type: "string" } }));
server.tool<{ message: string }>("echo", "Echo", { type: "object" }, (args, context) => {
  const signal: AbortSignal = context.signal;
  const state: string | undefined = context.requestState;
  return [args.message, signal.aborted, state];
});
server.registerTool(
  { name: "other", inputSchema: { type: "object" } },
  (_args, context: HandlerRequestContext) => context.clientCapabilities
);
const removed: boolean = server.removeTool("other");
const session = server.createMessageSession();
void session.handleMessage("ping", undefined, { requestId: 1 });
void server.handleMessage("ping");
session.close();
void removed;
void server.connect({ readable: new PassThrough(), writable: new PassThrough() });
void server.listen();
const [sdkClient, sdkServer] = InMemoryTransport.createLinkedPair();
void sdkClient;
const retryValid: boolean = validateProtocolValue("InputResponses", { one: { action: "accept" } });
void retryValid;
void server.connectSDK(sdkServer);
void session.handleSDKMessage({ jsonrpc: "2.0", id: "sdk", method: "ping" });
const line: Promise<string | undefined> = server
  .createMessageSession()
  .handleLine('{"jsonrpc":"2.0","id":1,"method":"ping"}');
void line;
const template = parseUriTemplate("memo://{name}");
const expanded: string = template.expand({ name: "a b" });
const captured: Record<string, string> | null = template.match(expanded);
void captured;
server.prompt(
  { name: "review", arguments: [{ name: "code", required: true }] },
  (args, context) => ({
    messages: [
      { role: "user", content: { type: "text", text: args.code + context.signal.aborted } }
    ]
  })
);
server.resource({ uri: "memo://welcome", name: "welcome" }, (uri) => ({
  contents: [{ uri, text: "hello" }]
}));
server.resourceTemplate({ uriTemplate: "memo://{name}", name: "memo" }, (uri) => ({
  contents: [{ uri, text: uri }]
}));
server.method("custom/value", (params, context) => ({
  value: params?.value,
  aborted: context.signal.aborted
}));
server.method("custom/notify", async (_params, context) => {
  await context.notify("notifications/test", { value: "ready" });
  return {};
});
const unsubscribe: () => void = server.onNotification((notification) => {
  const method: string = notification.method;
  void method;
});
unsubscribe();
const notifications: Promise<void>[] = [
  server.notifyToolsChanged(),
  server.notifyPromptsChanged(),
  server.notifyResourcesChanged(),
  server.notifyResourceUpdated("memo://welcome")
];
void notifications;
server
  .createMessageSession(async (notification) => {
    void notification.params;
  })
  .close();
const removedPrompt: boolean = server.removePrompt("review");
void removedPrompt;
