export interface Fixture {
  readonly id: string;
  readonly args: readonly string[];
  readonly input: Uint8Array;
  readonly fileInput?: boolean;
  readonly existing?: Readonly<Record<string, string>>;
  readonly bsd?: boolean;
}

const bytes = (text: string): Uint8Array => Buffer.from(text);
const binary = Uint8Array.from([0, 255, 10, 128, 13, 10, 0, 254, 65]);

export const fixtures: readonly Fixture[] = [
  { id: "default-empty", args: [], input: bytes(""), bsd: true },
  { id: "default-1000-lines", args: [], input: bytes("line\n".repeat(1001)), bsd: true },
  { id: "line-single", args: ["-l1"], input: bytes("one\ntwo\nthree"), bsd: true },
  { id: "line-unterminated", args: ["-l", "2"], input: bytes("one\ntwo\nthree"), bsd: true },
  { id: "line-terminal-newline", args: ["-l2"], input: bytes("one\ntwo\n"), bsd: true },
  { id: "line-blank", args: ["-l2"], input: bytes("\n\n\n\n\n"), bsd: true },
  { id: "line-binary", args: ["-l1"], input: binary, bsd: true },
  { id: "line-long", args: ["-l1"], input: bytes("q".repeat(131079) + "\ntail"), bsd: true },
  { id: "line-plus-count", args: ["-l", "+2"], input: bytes("a\nb\nc\n"), bsd: true },
  { id: "line-long-option", args: ["--lines=2", "-", "part-"], input: binary },
  { id: "byte-empty", args: ["-b2"], input: bytes(""), bsd: true },
  { id: "byte-binary", args: ["-b2"], input: binary, bsd: true },
  { id: "byte-equal", args: ["-b3"], input: binary, bsd: true },
  { id: "byte-long-option", args: ["--bytes=4", "-", "piece"], input: binary },
  { id: "byte-k", args: ["-b1k"], input: bytes("k".repeat(2050)), bsd: true },
  { id: "byte-bare-K", args: ["-bK"], input: bytes("k".repeat(1025)) },
  { id: "byte-KB", args: ["-b1KB"], input: bytes("k".repeat(2001)) },
  { id: "byte-KiB", args: ["-b1KiB"], input: bytes("k".repeat(2049)) },
  { id: "byte-block", args: ["-b1b"], input: bytes("k".repeat(1025)) },
  { id: "byte-large-unit", args: ["-b1G"], input: binary, bsd: true },
  { id: "byte-lower-m", args: ["-b1m"], input: binary, bsd: true },
  { id: "byte-spaced-plus", args: ["-b", " +2"], input: binary },
  { id: "C-records", args: ["-C5"], input: bytes("a\nb\nc\nd\n") },
  { id: "C-long-line", args: ["-C5"], input: bytes("1234567890123\nend\n") },
  { id: "C-terminal", args: ["-C5"], input: bytes("a\nb\nz") },
  { id: "C-empty", args: ["-C5"], input: bytes("") },
  { id: "C-binary", args: ["--line-bytes=3"], input: binary },
  { id: "C-unit", args: ["-CK"], input: bytes("abc\n".repeat(257)) },
  { id: "C-one-byte", args: ["-C1"], input: binary },
  { id: "C-boundaries", args: ["-C7"], input: bytes("abcdef\nz\n12345678\n9\n123456789") },
  { id: "numeric", args: ["-db2"], input: binary, bsd: true },
  { id: "numeric-start", args: ["--numeric-suffixes=007", "-b2"], input: binary },
  { id: "numeric-start-width", args: ["--numeric-suffixes=998", "-a4", "-b2"], input: binary },
  { id: "numeric-empty-start", args: ["--numeric-suffixes=", "-b2"], input: binary },
  { id: "additional-suffix", args: ["-a3", "--additional-suffix=.bin", "-b2", "-", "part-"], input: binary },
  { id: "empty-prefix", args: ["-b2", "-", ""], input: binary },
  { id: "dash-prefix", args: ["-b2", "--", "-", "-"], input: binary, bsd: true },
  { id: "file-input", args: ["-l1", "input", "part"], input: binary, fileInput: true, bsd: true },
  { id: "file-overwrite", args: ["-b4", "input", "part"], input: binary, fileInput: true, existing: { partaa: "OLD LONG CONTENT", partab: "OLD", partzz: "UNRELATED" }, bsd: true },
  { id: "stdin-overwrite", args: ["-b4", "-", "part"], input: binary, existing: { partaa: "OLD", partab: "OLDER" }, bsd: true },
  { id: "alphabet-autoextend", args: ["-b1"], input: bytes("z".repeat(652)) },
  { id: "numeric-autoextend", args: ["-db1"], input: bytes("z".repeat(92)) },
  { id: "zero-width-autoextend", args: ["-a0", "-db1"], input: bytes("z".repeat(92)) },
];
