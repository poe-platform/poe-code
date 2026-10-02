import { validateHeaderName,validateHeaderValue } from "./platform-portable.js";
import { CurlError } from "./types.js";

export interface DataArgument {
  readonly kind: "data" | "raw" | "binary" | "json" | "urlencode" | "form" | "form-string";
  readonly value: string;
}

export interface CurlArguments {
  insecure?: boolean;
  createDirs?: boolean;
  cookies?: string[];
  retryAllErrors?: boolean;
  retryConnrefused?: boolean;
  retryMaxTimeMs?: number;
  caFile?: string;
  etagSave?: string;
  etagCompare?: string;
  etag?: string;
  query?: DataArgument[];
  httpVersion?: "1.0" | "1.1";
  ignoreContentLength?: boolean;
  agent?: string;
  referer?: string;
  autoReferer?: boolean;
  retryTransport?: boolean;
  directoryIndex?: string;
  download?: { spider: boolean; resume: boolean; noClobber: boolean; contentDisposition: boolean };
  urls: string[];
  data: DataArgument[];
  headers: [string, string | null][];
  method?: string;
  range?: string;
  continueAt?: number | "auto";
  user?: string;
  bearer?: string;
  upload?: string;
  output?: string;
  outputs?: { output?: string; remoteName: boolean }[];
  outputDirectory?: string;
  dumpHeader?: string;
  writeOut?: string;
  include: boolean;
  head: boolean;
  get: boolean;
  location: boolean;
  remoteName: boolean;
  fail: boolean;
  failWithBody: boolean;
  silent: boolean;
  showError: boolean;
  verbose: boolean;
  globoff: boolean;
  help: boolean;
  version: boolean;
  compressed?: boolean;
  raw?: boolean;
  retries: number;
  retryDelayMs: number;
  maxTimeMs: number;
  connectTimeoutMs?: number;
  maxRedirects: number;
  maxFileSize: number;
}

export function validateRequestHeader(name: string, value: string): void {
  try { validateHeaderName(name); validateHeaderValue(name, value); }
  catch { throw new CurlError(2, "Invalid HTTP header"); }
  if (["content-length", "transfer-encoding", "proxy-authorization", "upgrade"].includes(name.toLowerCase())) {
    throw new CurlError(2, "Transport-controlled HTTP header is not supported");
  }
}
