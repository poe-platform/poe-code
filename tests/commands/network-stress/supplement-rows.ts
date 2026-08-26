export interface SupplementRow {
  id: string;
  kind: "native-parity" | "security" | "lifecycle";
  args: string[];
  input?: boolean;
  trust?: boolean;
}

export const payload = Buffer.from([0, 255, 254, 13, 10, 34, 59, 65, 128]);
export const supplementaryRows: readonly SupplementRow[] = [
  { id: "multipart-binary-file", kind: "native-parity", args: ["-F", "blob=@binary.bin;type=application/octet-stream;filename=sent.bin", "-F", "tag=after", "{A}/echo"] },
  { id: "multipart-binary-field", kind: "native-parity", args: ["-F", "blob=<binary.bin;type=application/octet-stream", "{A}/echo"] },
  { id: "multipart-binary-stdin", kind: "native-parity", input: true, args: ["-F", "blob=@-;filename=stdin.bin;type=application/octet-stream", "{A}/echo"] },
  { id: "multipart-form-string-literal", kind: "native-parity", args: ["--form-string", "text=@$(touch PWN);type=text/evil\r\nX-Injected: yes", "{A}/echo"] },
  { id: "multipart-307-replay", kind: "native-parity", args: ["-L", "-F", "blob=@binary.bin;type=application/octet-stream", "{A}/redirect307"] },
  { id: "literal-output-path", kind: "native-parity", args: ["-o", "$(touch PWN);out.bin", "{A}/bytes"] },
  { id: "url-control-rejection", kind: "security", args: ["{A}/bad\r\nX-Injected:yes"] },
  { id: "multipart-filename-control", kind: "security", args: ["-F", "blob=@binary.bin;filename=bad\r\nX-Injected:yes", "{A}/echo"] },
  { id: "redirect-authorization-denial", kind: "security", args: ["-L", "{A}/cross"] },
  { id: "origin-header-permanent-strip", kind: "security", args: ["-L", "-H", "X-Private: fixture-secret", "{A}/cross-return"] },
  { id: "https-downgrade-rejection", kind: "security", trust: true, args: ["-L", "{T}/downgrade"] },
  { id: "default-tls-untrusted", kind: "native-parity", args: ["{T}/bytes"] },
  { id: "default-missing-upload", kind: "native-parity", args: ["--data-binary", "@absent.bin", "{A}/echo"] },
  { id: "response-backpressure", kind: "lifecycle", args: ["{A}/synthetic"] },
  { id: "upload-backpressure", kind: "lifecycle", args: ["-T", "-", "{A}/synthetic"] },
  { id: "default-upload-cancellation", kind: "lifecycle", args: ["-T", "-", "{A}/uploadstall"] },
  { id: "default-response-cancellation", kind: "lifecycle", args: ["{A}/stall"] },
  { id: "late-transport-rejection", kind: "lifecycle", args: ["--max-time", "0.03", "{A}/synthetic"] },
];
