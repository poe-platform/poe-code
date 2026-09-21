import { native } from "./native.js";
import { createPostCompactionHookContext, createPreCompactionHookContext } from "./hooks.js";
import { estimateMessageContentSize } from "./tool-results.js";
import {
  readOptionalNonNegativeInteger,
  rejectUnknownKeys,
  toOptionsObject
} from "./parse-options.js";
const DEFAULT_CONTEXT_WINDOW = 200000;
const DEFAULT_THRESHOLD_RATIO = 0.8;
const DEFAULT_KEEP_LAST_TURNS = 3;
const COMPACTION_MESSAGE_NAME = "compaction";
const compactionPlugin = (options = {}) => ({
  name: "poe-agent-plugin-compaction",
  hooks: {
    async postIteration(ctx) {
      await compactIteration(ctx, options);
    }
  }
});
async function compactIteration(ctx, options) {
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
  const compactionPlan = native.planAgentCompaction(
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
function insertCompactionSummaryMessage(messages, summary) {
  const compactedMessages = [];
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
function createCompactionSummaryMessage(summary) {
  return {
    role: "system",
    name: COMPACTION_MESSAGE_NAME,
    content: native.formatAgentCompactionSummary(summary)
  };
}
function syncCompactionSummaryMessage(messages, summary) {
  for (const message of messages) {
    if (message.role === "system" && message.name === COMPACTION_MESSAGE_NAME) {
      message.content = native.formatAgentCompactionSummary(summary);
      return;
    }
  }
}
async function resolveCompactionSummary(options) {
  const summary = options.summarise
    ? await callCustomSummarise(options.summarise, options.messages, options.awareness)
    : await summariseWithModel(options.complete, options.messages, options.awareness);
  const normalizedSummary = summary.trim();
  return normalizedSummary.length > 0 ? normalizedSummary : "Earlier context was compacted.";
}
async function summariseWithModel(complete, messages, awareness) {
  return complete([
    {
      role: "system",
      content: [
        "Summarise the earlier conversation for the same coding task. Preserve goals, constraints, decisions, files, commands, errors, and open questions. Keep it concise and factual.",
        native.renderAgentCompactionAwareness(
          Array.from(awareness.readFiles),
          Array.from(awareness.modifiedFiles)
        )
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
async function callCustomSummarise(summarise, messages, awareness) {
  if (summarise.length < 2) {
    return summarise(messages);
  }
  return summarise(messages, awareness);
}
function estimateTokenCount(messages) {
  let count = 0;
  for (const message of messages) {
    count += estimateMessageContentSize(message.content);
  }
  return count;
}
export default compactionPlugin;
export const spec = {
  name: "compaction",
  parseOptions(input) {
    const obj = toOptionsObject(input);
    rejectUnknownKeys(obj, ["threshold", "contextWindow", "keepLastTurns"]);
    const options = {};
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
  factory: (options) => compactionPlugin(options)
};
