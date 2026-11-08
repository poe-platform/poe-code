import { native } from "./native.js";
export const ACP_ERROR_CODE_PARSE = -32700,
  ACP_ERROR_CODE_INVALID_REQUEST = -32600,
  ACP_ERROR_CODE_METHOD_NOT_FOUND = -32601,
  ACP_ERROR_CODE_INVALID_PARAMS = -32602,
  ACP_ERROR_CODE_INTERNAL = -32603,
  ACP_ERROR_CODE_AUTH_REQUIRED = -32000,
  ACP_ERROR_CODE_RESOURCE_NOT_FOUND = -32002;
export class AcpError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "AcpError";
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}
export const isAcpErrorCode = native.acpIsErrorCode;
export function isAcpError(value) {
  if (value instanceof AcpError) return true;
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    native.acpIsErrorCode(value.code) &&
    typeof value.message === "string" &&
    (value.data === undefined || Object.hasOwn(value, "data"))
  );
}
