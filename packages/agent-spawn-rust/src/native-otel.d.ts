export interface NativeOtelRecord {
  signal: "traces" | "logs" | "metrics";
  contentType?: string;
  body: Record<string, unknown> | string;
}
export interface NativeOtelCapture {
  env: Record<string, string>;
  args: string[];
  correlationId: string;
  drain(): Promise<NativeOtelRecord[]>;
}
export declare function startNativeOtelCapture(
  agentId: string,
  content?: boolean
): Promise<NativeOtelCapture | undefined>;
