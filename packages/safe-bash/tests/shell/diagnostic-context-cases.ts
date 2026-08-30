export const quoteDiagnostic = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export interface DiagnosticContextCase { name: string; group: "name" | "line"; source: string; files?: Record<string, string> }
const nul = "printf 'a\\0b\\0c'";
const inner = `printf '%s' "$(${nul})"`;
const bodies = [
  ["blank-separator", `:\n\n\n${inner}`],
  ["comments", `: # first\n# second\n\n${inner}`],
  ["leading-blank", `\n\n:\n${inner}`],
  ["semicolon-newlines", `:;\n\n${inner}`],
  ["and-continuation", `: &&\n\n${inner}`],
  ["or-continuation", `false ||\n\n${inner}`],
  ["pipe-continuation", `printf '' |\n\n${inner}`],
  ["quoted-newlines", `printf 'first\n\nlast' >scratch\n\n${inner}`],
  ["first-word-newline", `value='first\nlast'\n\n${inner}`],
  ["escaped-newline", `: \\\n ignored\n\n${inner}`],
  ["three-level", `:\n\nvalue=$(:\n\n${inner})\nprintf '%s' "$value"`],
] as const;
export const diagnosticContextCases: DiagnosticContextCase[] = [
  ...bodies.map(([name, body]) => ({ name, group: "line" as const, source: `:\nvalue=$(${body}\n); printf '<%s>' "$value"` })),
  { name: "named-dollar", group: "name", source: `bash -c ${quoteDiagnostic(`value=$(${nul}); printf '<%s>' "$value"`)} named-source` },
  { name: "named-backtick", group: "name", source: `bash -c ${quoteDiagnostic(`value=\`${nul}\`; printf '<%s>' "$value"`)} 'source with spaces'` },
  { name: "two-warnings", group: "name", source: `bash -c ${quoteDiagnostic(`first=$(${nul});\nsecond=$(${nul}); printf '%s/%s' "$first" "$second"`)} two-source` },
  { name: "file-context", group: "name", source: "bash ./program", files: { program: `:\nvalue=$(${nul}); printf '%s' "$value"` } },
  { name: "dot-context", group: "name", source: ". ./program", files: { program: `:\nvalue=$(${nul}); printf '%s' "$value"` } },
  { name: "source-context", group: "name", source: "source ./program", files: { program: `:\nvalue=$(${nul}); printf '%s' "$value"` } },
  { name: "eval-context", group: "name", source: `bash -c ${quoteDiagnostic(`:\neval ${quoteDiagnostic(`value=$(${nul}); printf '%s' "$value"`)}`)} eval-source` },
  { name: "function-context", group: "name", source: `bash -c ${quoteDiagnostic(`emit() { value=$(${nul}); printf '%s' "$value"; }; emit`)} function-source` },
  { name: "source-function-context", group: "name", source: ". ./program; emit", files: { program: `emit() { value=$(${nul}); printf '%s' "$value"; }` } },
  { name: "backtick-blank-control", group: "line", source: `value=\`\n\n${inner}\n\`; printf '%s' "$value"` },
  { name: "named-line-context", group: "line", source: `bash -c ${quoteDiagnostic(`:\nvalue=$(:\n\n${inner}\n); printf '%s' "$value"`)} named-lines` },
  { name: "source-line-context", group: "line", source: ". ./program", files: { program: `:\nvalue=$(:\n\n${inner}\n); printf '%s' "$value"` } },
  { name: "eval-line-context", group: "line", source: `:\neval ${quoteDiagnostic(`value=$(:\n\n${inner}\n); printf '%s' "$value"`)}` },
  { name: "binary-stream-control", group: "name", source: "printf 'a\\0b' | cat; printf 'x\\0y' >&2" },
];
