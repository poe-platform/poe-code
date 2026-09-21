import { native } from "./native.js";
function selection(entry) {
  const direct = entry.sessionUpdate;
  const decision =
    typeof direct === "string"
      ? native.acpStreamDecision(direct, false, undefined)
      : native.acpStreamDecision(
          undefined,
          typeof entry.jsonrpc === "string" && entry.method === "session/update",
          typeof entry.params?.update?.sessionUpdate === "string"
            ? entry.params.update.sessionUpdate
            : undefined
        );
  return { update: decision.envelope ? entry.params.update : entry, category: decision.category };
}
export function streamUpdate(entry) {
  return selection(entry).update;
}
export async function extractMessagesFromSessionUpdateStream(stream) {
  const updates = [];
  for await (const entry of stream) {
    const selected = selection(entry);
    if (selected.category === "messages") updates.push(selected.update);
  }
  return updates;
}
export async function extractUsageFromSessionUpdateStream(stream) {
  const updates = [];
  for await (const entry of stream) {
    const selected = selection(entry);
    if (selected.category === "usage") updates.push(selected.update);
  }
  return updates;
}
export async function extractToolCallSummariesFromSessionUpdateStream(stream) {
  const collector = new native.NativeAcpCollector(),
    references = [];
  for await (const entry of stream) {
    const selected = selection(entry),
      update = selected.update;
    if (selected.category !== "tools") continue;
    const projection = {
      sessionUpdate: update.sessionUpdate,
      toolCallId: update.toolCallId,
      title: update.title,
      kind: update.kind,
      status: update.status
    };
    for (const key of ["rawInput", "rawOutput"])
      if (update[key] !== undefined) {
        projection[key] = references.length;
        references.push(update[key]);
      }
    collector.push(JSON.stringify(projection));
  }
  const tools = collector.result("tools");
  for (const tool of tools)
    for (const key of ["rawInput", "rawOutput"])
      if (Object.hasOwn(tool, key)) tool[key] = references[tool[key]];
  return tools;
}
export function mapLegacyEventToSessionUpdates(event) {
  const references = [],
    projection = {
      event: event.event,
      threadId: event.threadId,
      text: event.text,
      entries: event.entries,
      id: event.id,
      toolCallId: event.toolCallId,
      title: event.title,
      status: event.status,
      kind: event.kind,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cachedTokens: event.cachedTokens,
      costUsd: event.costUsd
    };
  for (const key of ["input", "rawInput", "output", "path", "rawOutput"])
    if (Object.hasOwn(event, key)) {
      projection[key] = references.length;
      references.push(event[key]);
    }
  const updates = native.acpLegacy(JSON.stringify(projection));
  for (const update of updates)
    for (const key of ["rawInput", "rawOutput"])
      if (Object.hasOwn(update, key)) update[key] = references[update[key]];
  return updates;
}
