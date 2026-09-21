import { native } from "./native.js";
function selectEvent(event, retain) {
  const kind = event.event,
    descriptor = { event: typeof kind === "string" ? kind : undefined },
    host = { event };
  if (kind === "session_start") {
    const value = event.threadId;
    descriptor.threadId = typeof value === "string" ? value : undefined;
  }
  if (retain && kind === "agent_message") {
    host.text = event.text;
    descriptor.hasText = typeof host.text === "string" && host.text.length > 0;
  }
  if (retain && (kind === "tool_start" || kind === "tool_complete")) {
    for (const name of kind === "tool_start"
      ? ["id", "kind", "title"]
      : ["id", "kind", "path", "status"]) {
      const value = event[name];
      descriptor[name] = typeof value === "string" ? value : undefined;
    }
    if (kind === "tool_start") host.input = event.input;
  }
  return { descriptor, host };
}
function createSessionCapture(retain) {
  return async (ctx, next) => {
    await next();
    const source = ctx.eventStream,
      state = new native.NativeSessionCapture(),
      tools = [];
    if (retain) ctx.sessionResult = { output: "", messages: [], toolCalls: [] };
    const apply = (host, action) => {
      if (!action) return;
      if (action.type === "thread") {
        ctx.threadId = ctx.sessionId = action.threadId;
        return;
      }
      if (action === true || action.type === "message") {
        if (ctx.sessionResult) {
          ctx.sessionResult.messages.push(host.text);
          ctx.sessionResult.output +=
            (ctx.sessionResult.messages.length > 1 ? "\n" : "") + host.text;
        }
        return;
      }
      let tool = tools[action.index];
      if (!tool) {
        tool = tools[action.index] = {};
        ctx.sessionResult?.toolCalls.push(tool);
      }
      Object.assign(tool, action.fields);
      if (action.input && host.input !== undefined) tool.input = host.input;
    };
    for (const event of ctx.events) {
      const selected = selectEvent(event, retain);
      apply(
        selected.host,
        selected.descriptor.event === "agent_message"
          ? native.spawnCaptureMessage(retain, selected.descriptor.hasText === true)
          : state.observe(JSON.stringify(selected.descriptor), retain)
      );
    }
    if (!source) return;
    ctx.eventStream = (async function* () {
      for await (const event of source) {
        if (retain) ctx.events.push(event);
        const selected = selectEvent(event, retain);
        apply(
          selected.host,
          selected.descriptor.event === "agent_message"
            ? native.spawnCaptureMessage(retain, selected.descriptor.hasText === true)
            : state.observe(JSON.stringify(selected.descriptor), retain)
        );
        yield event;
      }
    })();
  };
}
export const sessionCapture = createSessionCapture(true),
  sessionMetadataCapture = createSessionCapture(false);
