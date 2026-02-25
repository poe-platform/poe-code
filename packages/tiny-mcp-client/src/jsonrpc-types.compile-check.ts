import type {
  JsonRpcErrorObject,
  JsonRpcErrorResponse,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  RequestId,
} from "./index.js";

const requestIdFromNumber: RequestId = 1;
const requestIdFromString: RequestId = "request-1";

// @ts-expect-error MCP does not allow null request ids.
const requestIdFromNull: RequestId = null;

const request: JsonRpcRequest = {
  jsonrpc: "2.0",
  id: requestIdFromNumber,
  method: "tools/list",
  params: { cursor: "next" },
};

const notification: JsonRpcNotification = {
  jsonrpc: "2.0",
  method: "notifications/initialized",
};

// @ts-expect-error Notifications must not define an id.
const notificationWithId: JsonRpcNotification = { jsonrpc: "2.0", id: requestIdFromString, method: "notifications/initialized" };

const successResponse: JsonRpcSuccessResponse = {
  jsonrpc: "2.0",
  id: requestIdFromNumber,
  result: { tools: [] },
};

const errorObject: JsonRpcErrorObject = {
  code: -32601,
  message: "Method not found",
  data: { method: request.method },
};

const errorResponse: JsonRpcErrorResponse = {
  jsonrpc: "2.0",
  id: requestIdFromString,
  error: errorObject,
};

const responses: JsonRpcResponse[] = [successResponse, errorResponse];

type AssertAssignable<To, ignoredFrom extends To> = true;

type ignoredResponseIncludesSuccess = AssertAssignable<
  JsonRpcResponse,
  JsonRpcSuccessResponse
>;
type ignoredResponseIncludesError = AssertAssignable<
  JsonRpcResponse,
  JsonRpcErrorResponse
>;

void requestIdFromNull;
void notification;
void notificationWithId;
void responses;
