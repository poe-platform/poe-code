import {
  createPostCompactionHookContext,
  createPreCompactionHookContext
} from "../runtime/hooks.js";
import type {
  AgentPlugin,
  CompactSummarise,
  FileAwareness,
  IterationCompactionOptions,
  IterationCompactionResult,
  IterationContext
} from "../runtime/plugin-types.js";
import { estimateMessageContentSize } from "../runtime/tool-results.js";
import type { ChatMessage } from "../runtime/types.js";
import {
  readOptionalNonNegativeInteger,
  rejectUnknownKeys,
  toOptionsObject
} from "./parse-options.js";
import type { PluginSpec } from "./registry.js";

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_THRESHOLD_RATIO = 0.8;
const DEFAULT_KEEP_LAST_TURNS = 3;
const COMPACTION_MESSAGE_NAME = "compaction";

export type CompactionPluginOptions = Pick<
  IterationCompactionOptions,
  "threshold" | "contextWindow" | "keepLastTurns" | "summarise"
>;

const compactionPlugin = (options: CompactionPluginOptions = {}): AgentPlugin => ({
  name: "poe-agent-plugin-compaction",
  hooks: {
    async postIteration(ctx) {
      await compactIteration(ctx, options);
    }
  }
});

async function compactIteration(
  ctx: IterationContext,
  options: CompactionPluginOptions
): Promise<IterationCompactionResult | undefined> {
  const tokenCount = estimateTokenCount(ctx.messages);
  const preCompactionContext = createPreCompactionHookContext({
    tokenCount,
    force: false,
    messages: ctx.messages,
    fileAwareness: {
      readFiles: ctx.readFiles,
      modifiedFiles: ctx.modifiedFiles
    },
    signal: ctx.signal
  });
  const preCompactionDispatch = await ctx.runHook("preCompaction", preCompactionContext);

  if (preCompactionDispatch.type === "skip") {
    return undefined;
  }

  const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const threshold = options.threshold ?? Math.floor(contextWindow * DEFAULT_THRESHOLD_RATIO);
  if (tokenCount <= threshold) {
    return undefined;
  }

  const compactionPlan = buildCompactionPlan(
    ctx.messages,
    options.keepLastTurns ?? DEFAULT_KEEP_LAST_TURNS
  );
  if (!compactionPlan) {
    return undefined;
  }

  const summary = await resolveCompactionSummary({
    complete: ctx.complete,
    messages: compactionPlan.droppedMessages,
    awareness: {
      readFiles: ctx.readFiles,
      modifiedFiles: ctx.modifiedFiles
    },
    summarise: options.summarise
  });
  const compactedMessages = insertCompactionSummaryMessage(compactionPlan.messages, summary);

  ctx.messages.splice(0, ctx.messages.length, ...compactedMessages);

  const postCompactionContext = createPostCompactionHookContext({
    tokenCount: estimateTokenCount(ctx.messages),
    summary,
    droppedMessages: compactionPlan.droppedMessages,
    messages: ctx.messages,
    fileAwareness: {
      readFiles: ctx.readFiles,
      modifiedFiles: ctx.modifiedFiles
    },
    signal: ctx.signal
  });
  await ctx.runHook("postCompaction", postCompactionContext);
  syncCompactionSummaryMessage(ctx.messages, postCompactionContext.summary);

  return {
    summary: postCompactionContext.summary,
    droppedMessages: postCompactionContext.droppedMessages
  };
}

function buildCompactionPlan(
  messages: ChatMessage[],
  keepLastTurns: number
): { messages: ChatMessage[]; droppedMessages: ChatMessage[] } | undefined {
  const tailStartIndex = findCompactionTailStart(messages, keepLastTurns);
  const compactedMessages: ChatMessage[] = [];
  const droppedMessages: ChatMessage[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }

    if (index < tailStartIndex && !shouldPreserveBeforeCompaction(message)) {
      droppedMessages.push(message);
      continue;
    }

    compactedMessages.push(message);
  }

  if (droppedMessages.length === 0) {
    return undefined;
  }

  return {
    messages: compactedMessages,
    droppedMessages
  };
}

function findCompactionTailStart(messages: ChatMessage[], keepLastTurns: number): number {
  let turnsRemaining = keepLastTurns;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "user") {
      continue;
    }

    turnsRemaining -= 1;
    if (turnsRemaining === 0) {
      return index;
    }
  }

  return messages.length;
}

function shouldPreserveBeforeCompaction(message: ChatMessage): boolean {
  return message.role === "system" && message.name !== COMPACTION_MESSAGE_NAME;
}

function insertCompactionSummaryMessage(messages: ChatMessage[], summary: string): ChatMessage[] {
  const compactedMessages: ChatMessage[] = [];
  const summaryMessage = createCompactionSummaryMessage(summary);
  let inserted = false;

  for (const message of messages) {
    if (!inserted && message.role !== "system") {
      compactedMessages.push(summaryMessage);
      inserted = true;
    }

    compactedMessages.push(message);
  }

  if (!inserted) {
    compactedMessages.push(summaryMessage);
  }

  return compactedMessages;
}

function createCompactionSummaryMessage(summary: string): ChatMessage {
  return {
    role: "system",
    name: COMPACTION_MESSAGE_NAME,
    content: formatCompactionSummary(summary)
  };
}

function syncCompactionSummaryMessage(messages: ChatMessage[], summary: string): void {
  for (const message of messages) {
    if (message.role === "system" && message.name === COMPACTION_MESSAGE_NAME) {
      message.content = formatCompactionSummary(summary);
      return;
    }
  }
}

function formatCompactionSummary(summary: string): string {
  return `Compacted context summary:\n${summary}`;
}

async function resolveCompactionSummary(options: {
  complete: IterationContext["complete"];
  messages: ChatMessage[];
  awareness: FileAwareness;
  summarise?: ((messages: ChatMessage[]) => string | Promise<string>) | CompactSummarise;
}): Promise<string> {
  const summary = options.summarise
    ? await callCustomSummarise(options.summarise, options.messages, options.awareness)
    : await summariseWithModel(options.complete, options.messages, options.awareness);

  const normalizedSummary = summary.trim();
  return normalizedSummary.length > 0 ? normalizedSummary : "Earlier context was compacted.";
}

async function summariseWithModel(
  complete: IterationContext["complete"],
  messages: ChatMessage[],
  awareness: FileAwareness
): Promise<string> {
  return complete([
    {
      role: "system",
      content: [
        "Summarise the earlier conversation for the same coding task. Preserve goals, constraints, decisions, files, commands, errors, and open questions. Keep it concise and factual.",
        renderFileAwarenessForSummary(awareness)
      ]
        .filter((part) => part.length > 0)
        .join("\n\n")
    },
    ...messages,
    {
      role: "user",
      content: "Provide a concise continuation summary for the dropped context only."
    }
  ]);
}

async function callCustomSummarise(
  summarise: ((messages: ChatMessage[]) => string | Promise<string>) | CompactSummarise,
  messages: ChatMessage[],
  awareness: FileAwareness
): Promise<string> {
  if (summarise.length < 2) {
    return (summarise as (messages: ChatMessage[]) => string | Promise<string>)(messages);
  }

  return (summarise as CompactSummarise)(messages, awareness);
}

function renderFileAwarenessForSummary(awareness: FileAwareness): string {
  const lines: string[] = [];
  const readFiles = Array.from(awareness.readFiles).sort();
  const modifiedFiles = Array.from(awareness.modifiedFiles).sort();

  if (readFiles.length > 0) {
    lines.push("Files read before compaction:", ...readFiles.map((filePath) => `- ${filePath}`));
  }

  if (modifiedFiles.length > 0) {
    lines.push(
      "Files modified before compaction:",
      ...modifiedFiles.map((filePath) => `- ${filePath}`)
    );
  }

  return lines.join("\n");
}

function estimateTokenCount(messages: ChatMessage[]): number {
  let count = 0;

  for (const message of messages) {
    count += estimateMessageContentSize(message.content);
  }

  return count;
}

export default compactionPlugin;

export type CompactionPluginConfigOptions = Pick<
  CompactionPluginOptions,
  "threshold" | "contextWindow" | "keepLastTurns"
>;

export const spec: PluginSpec<CompactionPluginConfigOptions> = {
  name: "compaction",
  parseOptions(input) {
    const obj = toOptionsObject(input);
    rejectUnknownKeys(obj, ["threshold", "contextWindow", "keepLastTurns"]);
    const options: CompactionPluginConfigOptions = {};
    const threshold = readOptionalNonNegativeInteger(obj, "threshold");
    if (threshold !== undefined) {
      options.threshold = threshold;
    }
    const contextWindow = readOptionalNonNegativeInteger(obj, "contextWindow");
    if (contextWindow !== undefined) {
      options.contextWindow = contextWindow;
    }
    const keepLastTurns = readOptionalNonNegativeInteger(obj, "keepLastTurns");
    if (keepLastTurns !== undefined) {
      options.keepLastTurns = keepLastTurns;
    }
    return options;
  },
  factory: options => compactionPlugin(options),
};
