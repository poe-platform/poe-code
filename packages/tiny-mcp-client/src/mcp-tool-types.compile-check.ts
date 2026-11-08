import type {
  AudioContent,
  CallToolParams,
  CallToolResult,
  ContentItem,
  EmbeddedResource,
  ImageContent,
  ResourceContents,
  TextContent,
  Tool,
  ToolAnnotations,
} from "./index.js";

const annotations: ToolAnnotations = {
  title: "Word of the day",
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const tool: Tool = {
  name: "word_of_the_day",
  title: "Word of the day",
  description: "Returns a random word.",
  inputSchema: {
    type: "object",
    properties: {
      locale: { type: "string" },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      word: { type: "string" },
    },
    required: ["word"],
  },
  annotations,
};

const callToolParams: CallToolParams = {
  name: tool.name,
  arguments: {
    locale: "en-US",
  },
};

const resourceContents: ResourceContents = {
  uri: "file:///tmp/word.txt",
  text: "quotidian",
};

const textContent: TextContent = {
  type: "text",
  text: "quotidian",
};

const imageContent: ImageContent = {
  type: "image",
  data: "YmFzZTY0",
  mimeType: "image/png",
};

const audioContent: AudioContent = {
  type: "audio",
  data: "YmFzZTY0",
  mimeType: "audio/wav",
};

const embeddedResource: EmbeddedResource = {
  type: "resource",
  resource: resourceContents,
};

const contentItems: ContentItem[] = [
  textContent,
  imageContent,
  audioContent,
  embeddedResource,
];

const callToolResult: CallToolResult = {
  content: contentItems,
  structuredContent: {
    word: "quotidian",
  },
};

const callToolErrorResult: CallToolResult = {
  content: [textContent],
  isError: true,
};

// @ts-expect-error Tool.name is required.
const toolMissingName: Tool = {
  inputSchema: {},
};

// @ts-expect-error Tool.inputSchema is required.
const toolMissingInputSchema: Tool = {
  name: "word_of_the_day",
};

// @ts-expect-error CallToolParams.name is required.
const callToolParamsMissingName: CallToolParams = {
  arguments: {},
};

const invalidTextContent: TextContent = {
  // @ts-expect-error TextContent.type must be "text".
  type: "image",
  text: "oops",
};

// @ts-expect-error EmbeddedResource.resource is required.
const embeddedResourceMissingResource: EmbeddedResource = {
  type: "resource",
};

void toolMissingName;
void toolMissingInputSchema;
void callToolParamsMissingName;
void invalidTextContent;
void embeddedResourceMissingResource;
void callToolParams;
void callToolResult;
void callToolErrorResult;
