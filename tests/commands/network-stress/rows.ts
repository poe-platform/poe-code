export interface Row {
  readonly id: string;
  readonly args: readonly string[];
  readonly input?: string;
  readonly mode?: "sigint" | "head" | "security";
  readonly diagnostic?: string;
  readonly code?: number;
}

export const binary = Buffer.from([0, 255, 254, 65, 13, 10, 128, 0, 66]);
export const text = Buffer.from("first\r\nsecond\n\0tail");
export const seeds: Readonly<Record<string, Buffer>> = {
  "binary.in": binary,
  "text.in": text,
  "result.bin": Buffer.from("old bytes must disappear"),
};

export const rows: readonly Row[] = [
  { id: "get", args: ["{A}/echo"] },
  { id: "head-method", args: ["-I", "{A}/bytes"] },
  { id: "include-headers", args: ["-i", "{A}/bytes"] },
  { id: "dump-headers", args: ["-D", "headers.out", "{A}/bytes"] },
  { id: "method-before-body", args: ["-X", "PATCH", "-d", "a=1", "{A}/echo"] },
  { id: "body-before-method", args: ["-d", "a=1", "-X", "PUT", "{A}/echo"] },
  { id: "repeated-body", args: ["-d", "a=1", "-d", "b=2", "{A}/echo"] },
  { id: "raw-at-literal", args: ["--data-raw", "@missing", "{A}/echo"] },
  { id: "data-file-strips", args: ["-d", "@text.in", "{A}/echo"] },
  { id: "binary-file", args: ["--data-binary", "@binary.in", "{A}/echo"] },
  { id: "binary-stdin", args: ["--data-binary", "@-", "{A}/echo"], input: binary.toString("base64") },
  { id: "data-stdin", args: ["-d", "@-", "{A}/echo"], input: text.toString("base64") },
  { id: "upload-file-put", args: ["-T", "binary.in", "{A}/echo"] },
  { id: "upload-stdin-put", args: ["-T", "-", "{A}/echo"], input: binary.toString("base64") },
  { id: "repeated-header-case", args: ["-H", "X-Probe: first", "-H", "x-probe: second", "{A}/echo"] },
  { id: "suppress-default-header", args: ["-H", "Accept:", "{A}/echo"] },
  { id: "empty-header", args: ["-H", "X-Empty;", "{A}/echo"] },
  { id: "basic-auth", args: ["-u", "alice:secret", "{A}/echo"] },
  { id: "empty-credentials", args: ["-u", ":", "{A}/echo"] },
  { id: "bearer-auth", args: ["--oauth2-bearer", "fixture-token", "{A}/echo"] },
  { id: "binary-download", args: ["{A}/bytes"] },
  { id: "binary-output-overwrite", args: ["-o", "result.bin", "{A}/bytes"] },
  { id: "http404-default", args: ["{A}/status/404"] },
  { id: "http404-fail", args: ["--fail", "{A}/status/404"], code: 22, diagnostic: "404" },
  { id: "http404-fail-body", args: ["--fail-with-body", "{A}/status/404"], code: 22, diagnostic: "404" },
  ...[301, 302, 303, 307, 308].map((status): Row => ({
    id: `post-redirect-${status}`, args: ["-L", "-d", "payload", `{A}/redirect/${status}`],
  })),
  { id: "relative-location", args: ["-L", "{A}/relative/start"] },
  { id: "redirect-cycle", args: ["-L", "--max-redirs", "2", "{A}/cycle"], code: 47, diagnostic: "redirect" },
  { id: "cross-port-basic", args: ["-L", "-u", "alice:secret", "{A}/cross-port"] },
  { id: "cross-host-basic", args: ["-L", "-u", "alice:secret", "{A}/cross-host"] },
  { id: "cross-port-bearer", args: ["-L", "--oauth2-bearer", "fixture-token", "{A}/cross-port"] },
  { id: "cross-port-custom-auth", args: ["-L", "-H", "Authorization: Bearer custom", "{A}/cross-port"] },
  { id: "same-origin-auth", args: ["-L", "-u", "alice:secret", "{A}/redirect/302"] },
  { id: "explicit-post-redirect", args: ["-L", "-X", "POST", "-d", "payload", "{A}/redirect/302"] },
  { id: "timeout-no-headers", args: ["--max-time", "0.35", "{A}/hang"], code: 28, diagnostic: "timed? ?out|timeout" },
  { id: "timeout-partial", args: ["-N", "--max-time", "0.35", "{A}/stall"], code: 28, diagnostic: "timed? ?out|timeout" },
  { id: "disconnect-stdout", args: ["{A}/partial"], code: 18, diagnostic: "(outstanding|remaining|missing|partial|closed)" },
  { id: "disconnect-output", args: ["-o", "result.bin", "{A}/partial"], code: 18, diagnostic: "(outstanding|remaining|missing|partial|closed)" },
  { id: "retry-get", args: ["--retry", "1", "{A}/retry"] },
  { id: "retry-post-effect", args: ["--retry", "1", "-d", "effect", "{A}/retry"] },
  { id: "retry-output-reset", args: ["--retry", "1", "-o", "result.bin", "{A}/retry"] },
  { id: "retry-does-not-retry404", args: ["--retry", "1", "{A}/status/404"] },
  { id: "unknown-option", args: ["--not-a-real-curl-option"], code: 2, diagnostic: "option" },
  { id: "missing-option-value", args: ["--header"], code: 2, diagnostic: "(parameter|argument)" },
  { id: "missing-url", args: [], code: 2, diagnostic: "(URL|url)" },
  { id: "malformed-port", args: ["http://127.0.0.1:bad/"], code: 3, diagnostic: "(port|URL|url)" },
  { id: "forbidden-file-protocol", args: ["file://{ROOT}/binary.in"], code: 1, diagnostic: "(protocol|disabled|support)" },
  { id: "malformed-url-space", args: ["{A}/bad path"], code: 3, diagnostic: "(URL|url|malformed)" },
  { id: "header-crlf-injection", args: ["-H", "X-Probe: good\r\nX-Injected: yes", "{A}/echo"], mode: "security" },
  { id: "missing-input-file", args: ["--data-binary", "@missing.in", "{A}/echo"], code: 26, diagnostic: "(read|file|data)" },
  { id: "missing-output-parent", args: ["-o", "absent/result.bin", "{A}/bytes"], code: 23, diagnostic: "(writ|file|directory)" },
  { id: "active-sigint", args: ["{A}/hang"], mode: "sigint" },
  { id: "early-head-stream", args: ["-N", "{A}/stream"], mode: "head" },
  { id: "early-head-stalled", args: ["-N", "--max-time", "0.35", "{A}/stall"], mode: "head" },
];

export const contractRows = ["network-not-ambient", "authorization-denied"] as const;
export const outputPaths = ["result.bin", "headers.out", "absent/result.bin"] as const;
