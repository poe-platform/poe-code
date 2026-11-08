import type {
  CompleteParams,
  CompleteResult,
  CreateMessageParams,
  CreateMessageResult,
  LogLevel,
  LogMessage,
  ModelPreferences,
  ProgressParams,
  PromptReference,
  ResourceReference,
  Root,
  SamplingMessage,
} from "./index.js";

const root: Root = {
  uri: "file:///workspace",
  name: "workspace",
};

const logLevel: LogLevel = "info";

const logMessage: LogMessage = {
  level: logLevel,
  logger: "tiny-mcp-client",
  data: {
    message: "connected",
  },
};

const progress: ProgressParams = {
  progressToken: "request-1",
  progress: 40,
  total: 100,
  message: "Processing",
};

const samplingMessage: SamplingMessage = {
  role: "user",
  content: {
    type: "text",
    text: "Generate a summary.",
  },
};

const modelPreferences: ModelPreferences = {
  hints: [{ name: "claude" }],
  costPriority: 0.5,
  speedPriority: 0.6,
  intelligencePriority: 0.9,
};

const createMessageParams: CreateMessageParams = {
  messages: [samplingMessage],
  modelPreferences,
  systemPrompt: "Be concise.",
  includeContext: "none",
  temperature: 0.3,
  maxTokens: 512,
  stopSequences: ["\n\n"],
  metadata: {
    traceId: "trace-1",
  },
};

const createMessageResult: CreateMessageResult = {
  model: "claude-sonnet-4.5",
  role: "assistant",
  content: {
    type: "text",
    text: "Here is the summary.",
  },
  stopReason: "endTurn",
};

const promptReference: PromptReference = {
  type: "ref/prompt",
  name: "summarize",
};

const resourceReference: ResourceReference = {
  type: "ref/resource",
  uri: "file:///workspace/{path}",
};

const completePromptParams: CompleteParams = {
  ref: promptReference,
  argument: {
    name: "topic",
    value: "machine learning",
  },
};

const completeResourceParams: CompleteParams = {
  ref: resourceReference,
  argument: {
    name: "path",
    value: "docs/",
  },
};

const completeResult: CompleteResult = {
  completion: {
    values: ["docs/guide.md", "docs/api.md"],
    hasMore: true,
    total: 10,
  },
};

// @ts-expect-error Root.uri is required.
const rootMissingUri: Root = {
  name: "workspace",
};

// @ts-expect-error LogLevel must be one of syslog severities.
const invalidLogLevel: LogLevel = "trace";

// @ts-expect-error LogMessage.data is required.
const logMessageMissingData: LogMessage = {
  level: "info",
};

// @ts-expect-error ProgressParams.progressToken is required.
const progressMissingToken: ProgressParams = {
  progress: 1,
};

// @ts-expect-error CreateMessageParams.maxTokens is required.
const createMessageParamsMissingMaxTokens: CreateMessageParams = {
  messages: [samplingMessage],
};

const invalidSamplingRole: SamplingMessage = {
  // @ts-expect-error SamplingMessage.role must be "user" | "assistant".
  role: "system",
  content: {
    type: "text",
    text: "invalid",
  },
};

// @ts-expect-error CreateMessageResult.model is required.
const createMessageResultMissingModel: CreateMessageResult = {
  role: "assistant",
  content: {
    type: "text",
    text: "missing model",
  },
  stopReason: "endTurn",
};

const invalidCompleteParams: CompleteParams = {
  ref:
    // @ts-expect-error CompleteParams.ref.type must be "ref/prompt" | "ref/resource".
    { type: "prompt", name: "summarize" },
  argument: {
    name: "topic",
    value: "a",
  },
};

// @ts-expect-error CompleteResult.completion is required.
const completeResultMissingCompletion: CompleteResult = {};

void rootMissingUri;
void invalidLogLevel;
void logMessageMissingData;
void progressMissingToken;
void createMessageParamsMissingMaxTokens;
void invalidSamplingRole;
void createMessageResultMissingModel;
void invalidCompleteParams;
void completeResultMissingCompletion;
void root;
void logMessage;
void progress;
void createMessageParams;
void createMessageResult;
void completePromptParams;
void completeResourceParams;
void completeResult;
