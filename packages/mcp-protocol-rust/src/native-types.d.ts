export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface ParseResult {
  success: true;
  request: {
    jsonrpc: "2.0";
    id?: string | number | null;
    method: string;
    params?: Record<string, unknown>;
  };
  isNotification: boolean;
}

export interface ParseError {
  success: false;
  error: JsonRpcError;
  id: string | number | null;
}
