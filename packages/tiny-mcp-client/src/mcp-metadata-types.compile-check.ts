import type {
  AudioContent, BlobResourceContents, ContentAnnotations, EmbeddedResource,
  Icon, ImageContent, Prompt, PromptArgument, Resource, ResourceLink,
  ResourceTemplate, TextContent, TextResourceContents, Tool, ToolExecution,
} from "./index.js";

const icons: Icon[] = [{ src: "https://example.com/icon.png", theme: "dark" }];
const annotations: ContentAnnotations = { audience: ["assistant"], priority: 0.5 };
const metadata = { source: "fixture" };
const resource: Resource = { uri: "file:///data", name: "data", title: "Data", icons, annotations, _meta: metadata };
const link: ResourceLink = { ...resource, type: "resource_link" };
const template: ResourceTemplate = { uriTemplate: "file:///{name}", name: "data", title: "Data", icons, annotations, _meta: metadata };
const argument: PromptArgument = { name: "subject", title: "Subject" };
const prompt: Prompt = { name: "describe", title: "Describe", icons, arguments: [argument], _meta: metadata };
const execution: ToolExecution = { taskSupport: "forbidden" };
const tool: Tool = { name: "read", inputSchema: { type: "object" }, icons, execution, _meta: metadata };
const text: TextContent = { type: "text", text: "hello", annotations, _meta: metadata };
const image: ImageContent = { type: "image", data: "AA==", mimeType: "image/png", annotations, _meta: metadata };
const audio: AudioContent = { type: "audio", data: "AA==", mimeType: "audio/wav", annotations, _meta: metadata };
const textResource: TextResourceContents = { uri: resource.uri, text: "hello", _meta: metadata };
const blobResource: BlobResourceContents = { uri: resource.uri, blob: "AA==", _meta: metadata };
const embedded: EmbeddedResource = { type: "resource", resource: textResource, annotations, _meta: metadata };
void [link, template, prompt, tool, text, image, audio, blobResource, embedded];
