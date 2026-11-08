import * as own from "../dist/index.js";
import type * as reference from "@poe-code/poe-acp-client";
type ProtocolExports = Pick<
  typeof reference,
  | "AcpError"
  | "isAcpError"
  | "isAcpErrorCode"
  | "parseJsonRpcMessage"
  | "serializeJsonRpcMessage"
  | "createJsonRpcErrorResponse"
  | "formatSessionUpdate"
  | "parseSessionUpdate"
>;
const a: ProtocolExports = own;
const b: Pick<typeof own, keyof ProtocolExports> = null as unknown as ProtocolExports;
void [a, b];
type FunctionExports = Pick<
  typeof reference,
  | "extractMessagesFromSessionUpdateStream"
  | "extractUsageFromSessionUpdateStream"
  | "extractToolCallSummariesFromSessionUpdateStream"
  | "mapLegacyEventToSessionUpdates"
  | "generateRunReportFromSessionUpdateStream"
  | "formatRunReportSummary"
  | "saveRunReport"
>;
const c: FunctionExports = own;
const d: Pick<typeof own, keyof FunctionExports> = null as unknown as FunctionExports;
type PublicClient = Pick<reference.AcpClient, keyof reference.AcpClient>;
type PublicTransport = Pick<reference.AcpTransport, keyof reference.AcpTransport>;
type PublicLayer = Pick<reference.JsonRpcMessageLayer, keyof reference.JsonRpcMessageLayer>;
const e: PublicClient = null as unknown as own.AcpClient;
const f: own.AcpClient = null as unknown as PublicClient;
const g: PublicTransport = null as unknown as own.AcpTransport;
const h: own.AcpTransport = null as unknown as PublicTransport;
const i: PublicLayer = null as unknown as own.JsonRpcMessageLayer;
const j: own.JsonRpcMessageLayer = null as unknown as PublicLayer;
void [c, d, e, f, g, h, i, j];
