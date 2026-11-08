import { native } from "./native.js";
export const toRenderKind = native.spawnRenderKind;
export function createToolRenderState() {
  return { startedToolCalls: new Set(), toolCallKinds: new Map(), toolCallTitles: new Map() };
}
function stringifyOutput(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
export function sessionUpdateToEvents(update, state) {
  const type = update.sessionUpdate,
    tool = type === "tool_call" || type === "tool_call_update",
    usage = type === "usage_update",
    id = tool ? update.toolCallId : undefined;
  const descriptor = { sessionUpdate: type };
  if (tool)
    Object.assign(descriptor, {
      toolCallId: id,
      kind: update.kind,
      status: update.status,
      location: update.locations?.[0]?.path
    });
  else if (type === "agent_message_chunk" || type === "agent_thought_chunk")
    descriptor.content = { type: update.content.type, text: update.content.text };
  if (type === "tool_call") descriptor.title = update.title;
  let numbers = [],
    cost;
  if (usage) {
    const meta = update._meta ?? {};
    descriptor.usd = update.cost?.currency === "USD";
    if (descriptor.usd) cost = update.cost.amount;
    numbers = [
      update.used,
      update.size,
      meta.inputTokens,
      meta.outputTokens,
      meta.cachedTokens,
      cost
    ].map((value) => (typeof value === "number" ? value : null));
  }
  const plan = native.spawnRenderConvert(
    JSON.stringify(descriptor),
    tool ? state.startedToolCalls.has(id) : false,
    tool ? state.toolCallKinds.get(id) : undefined,
    tool ? state.toolCallTitles.get(id) : undefined,
    numbers
  );
  if (plan.track) {
    state.toolCallKinds.set(id, plan.kind);
    state.toolCallTitles.set(id, plan.title);
    if (plan.start) state.startedToolCalls.add(id);
  }
  for (const event of plan.events) {
    if (event.event === "plan") event.entries = update.entries;
    if (event.event === "tool_start") {
      const input = update.rawInput;
      if (input !== undefined) event.input = input;
    }
    if (event.event === "tool_complete") {
      const raw = stringifyOutput(update.rawOutput);
      if (native.spawnIsNonempty(raw)) event.path = raw;
      else {
        const content = update.content?.map((part) => ({ type: part.type, text: part.text })) ?? [];
        event.path = native.spawnRenderOutput(JSON.stringify(content));
      }
    }
    if (event.event === "usage" && descriptor.usd && typeof cost !== "number") event.costUsd = cost;
  }
  return plan.events;
}
