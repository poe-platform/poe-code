import type { SessionUpdate, ToolCall, ToolKind } from "./types.js";
import type { SessionUpdate as SessionUpdateFromIndex } from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

type ignoredSessionUpdateIsExported = AssertAssignable<SessionUpdate, SessionUpdateFromIndex>;

type ignoredToolCallExampleIsValid = AssertAssignable<
  ToolCall,
  { sessionUpdate: "tool_call"; toolCallId: "x"; title: "npm test"; kind: "execute" }
>;

// @ts-expect-error 'exec' is not a valid ACP ToolKind
type ignoredInvalidToolKind = AssertAssignable<ToolKind, "exec">;

// @ts-expect-error sessionUpdate discriminator is required
type ignoredToolCallMissingDiscriminator = AssertAssignable<ToolCall, { toolCallId: "x"; title: "npm test" }>;
