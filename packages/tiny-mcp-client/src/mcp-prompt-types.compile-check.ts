import type {
  ContentItem,
  GetPromptResult,
  Prompt,
  PromptArgument,
  PromptMessage,
} from "./index.js";

const promptArgument: PromptArgument = {
  name: "topic",
  description: "Topic to generate a prompt for",
  required: true,
};

const prompt: Prompt = {
  name: "summarize",
  description: "Summarize provided text",
  arguments: [promptArgument],
};

const promptMessage: PromptMessage = {
  role: "user",
  content: {
    type: "text",
    text: "Summarize this text.",
  },
};

const promptResult: GetPromptResult = {
  description: "Prompt for summarizing text",
  messages: [promptMessage],
};

const contentItems: ContentItem[] = [promptMessage.content];

// @ts-expect-error Prompt.name is required.
const promptMissingName: Prompt = {
  description: "missing name",
};

// @ts-expect-error PromptArgument.name is required.
const promptArgumentMissingName: PromptArgument = {
  description: "missing name",
};

const invalidPromptMessageRole: PromptMessage = {
  // @ts-expect-error PromptMessage.role must be "user" | "assistant".
  role: "system",
  content: {
    type: "text",
    text: "nope",
  },
};

// @ts-expect-error GetPromptResult.messages is required.
const promptResultMissingMessages: GetPromptResult = {
  description: "missing messages",
};

void contentItems;
void prompt;
void promptResult;
void promptMissingName;
void promptArgumentMissingName;
void invalidPromptMessageRole;
void promptResultMissingMessages;
