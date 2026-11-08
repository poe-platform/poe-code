import type {
  SessionUpdate as AcpClientSessionUpdate,
  ToolKind as AcpClientToolKind
} from "./acp-protocol-types.js";
import type {
  AcpEvent,
  SessionUpdate as LegacySessionUpdate,
  ToolKind as LegacyToolKind
} from "./acp-types.js";
type ConvertibleSessionUpdate = AcpClientSessionUpdate | LegacySessionUpdate;
type ConvertibleToolKind = AcpClientToolKind | LegacyToolKind;
export interface ToolRenderState {
  startedToolCalls: Set<string>;
  toolCallKinds: Map<string, string>;
  toolCallTitles: Map<string, string>;
}
export declare function createToolRenderState(): ToolRenderState;
export declare function toRenderKind(kind: ConvertibleToolKind | undefined | null): string;
export declare function sessionUpdateToEvents(
  update: ConvertibleSessionUpdate,
  state: ToolRenderState
): AcpEvent[];
export {};
