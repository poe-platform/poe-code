export interface InvocationFixture {
  readonly name: string;
  readonly args: readonly string[];
  readonly stdin?: string | readonly number[];
  readonly files?: Readonly<Record<string, { text?: string; bytes?: readonly number[]; mode?: number; directory?: boolean; link?: string }>>;
  readonly policyDifference?: string;
}

const argumentsSource = 'printf "[%s][%s]" "$0" "$#"; printf "<%s>" "$@"';
const tool = { text: '#!/bin/bash\nprintf "[%s][%s]\\n" "$0" "$1"', mode: 0o755 };

export const invocationFixtures: readonly InvocationFixture[] = [
  { name: "c-default-name", args: ["-c", argumentsSource] },
  { name: "c-literal-arguments", args: ["-c", argumentsSource, "label", "", "two words", "*", "$(bad)", ";", "é"] },
  { name: "c-empty-name", args: ["-c", argumentsSource, "", "-x"] },
  { name: "c-empty-source", args: ["-c", "", "label", "argument"] },
  { name: "c-dash-name", args: ["-c", argumentsSource, "-label", "--"] },
  { name: "c-end-options", args: ["-c", "--", argumentsSource, "name"] },
  { name: "c-repeated-clusters", args: ["-scs", "-c", "-s", argumentsSource, "name", ""] },
  { name: "c-missing", args: ["-c"] },
  { name: "c-missing-after-terminator", args: ["-c", "--"] },
  { name: "stdin-default", args: [], stdin: argumentsSource + "\n" },
  { name: "stdin-empty", args: ["-s"], stdin: "" },
  { name: "stdin-end-options", args: ["--"], stdin: argumentsSource + "\n" },
  { name: "stdin-dash-terminator", args: ["-"], stdin: argumentsSource + "\n" },
  { name: "stdin-literal-args", args: ["-ss", "--", "", "-x", "--"], stdin: argumentsSource + "\n" },
  { name: "stdin-first-operand-ends-options", args: ["-s", "first", "-c", ""], stdin: argumentsSource + "\n" },
  { name: "file-dash-after-end-options", args: ["--", "-", "arg"], files: { "-": { text: argumentsSource } } },
  { name: "file-dash-after-dash", args: ["-", "-", "arg"], files: { "-": { text: argumentsSource } } },
  { name: "c-shared-binary-data", args: ["-c", "cat"], stdin: [0, 255, 128, 10] },
  { name: "stdin-cat-shared-binary-data", args: ["-s"], stdin: [...Buffer.from("cat\n"), 0, 255, 128, 10, ...Buffer.from("printf never >marker\n")] },
  { name: "stdin-read-shared-cursor", args: ["-s"], stdin: 'read -r value\nhello world\nprintf "[%s]\\n" "$value"\n' },
  { name: "stdin-read-same-unit", args: ["-s"], stdin: 'read -r value; printf "[%s]\\n" "$value"\nhello world\nprintf end\n' },
  { name: "stdin-read-one-byte", args: ["-s"], stdin: 'read -r -N 1 value\nZprintf "[%s]\\n" "$value"\n' },
  { name: "stdin-final-no-newline", args: [], stdin: "printf final" },
  { name: "stdin-compound", args: [], stdin: 'if true; then\nread -r value\nprintf "[%s]" "$value"\nfi\nDATA\nprintf end\n' },
  { name: "stdin-continuation", args: [], stdin: 'printf "[%s]" \\\n"continued"\nprintf end\n' },
  { name: "stdin-quote", args: [], stdin: 'printf "%s" "first\nsecond"\nprintf end\n' },
  { name: "stdin-substitution", args: [], stdin: 'printf "[%s]" "$(\nprintf nested\n)"\n' },
  { name: "stdin-comments-and-blank", args: [], stdin: '# comment \\\n\n# another\nprintf yes\n' },
  { name: "stdin-heredoc", args: [], stdin: 'cat <<END\nbody\nEND\nprintf end\n' },
  { name: "stdin-two-heredocs", args: [], stdin: 'cat <<FIRST <<SECOND\nignored\nFIRST\nbody\nSECOND\nprintf end\n' },
  { name: "stdin-pipeline-continuation", args: [], stdin: 'printf pipe |\ncat\nprintf end\n' },
  { name: "stdin-exit-preserves-effects", args: [], stdin: 'printf before >before\nexit 9\nprintf after >after\n' },
  { name: "stdin-later-syntax", args: [], stdin: ': >before\n)\n: >after\n' },
  { name: "stdin-incomplete-eof", args: [], stdin: ': >before\nif true; then\n: >after' },
  { name: "c-later-syntax", args: ["-c", ': >before\n)\n: >after\n', "named"] },
  { name: "c-environment-status", args: ["-c", 'printf "[%s][%s]" "$?" "$PUBLIC"; exit 258'] },
  { name: "path-first-executable", args: ["-c", 'PATH=deny:bin; tool argument'], files: { "deny/tool": { ...tool, mode: 0o644 }, "bin/tool": tool } },
  { name: "path-skips-directory", args: ["-c", 'PATH=dir:bin; tool argument'], files: { "dir/tool": { directory: true }, "bin/tool": tool } },
  { name: "path-skips-dangling", args: ["-c", 'PATH=links:bin; tool argument'], files: { "links/tool": { link: "missing" }, "bin/tool": tool } },
  { name: "path-symlink", args: ["-c", 'PATH=links; tool argument'], files: { "links/tool": { link: "../bin/tool" }, "bin/tool": tool } },
  { name: "path-empty-component", args: ["-c", 'PATH=missing::elsewhere; tool argument'], files: { tool } },
  { name: "path-empty", args: ["-c", 'PATH=; tool argument'], files: { tool } },
  { name: "path-unset", args: ["-c", 'unset PATH; tool argument'], files: { tool } },
  { name: "path-prefix-assignment", args: ["-c", 'PATH=missing; PATH=bin tool argument; printf "[%s]" "$PATH"'], files: { "bin/tool": tool } },
  { name: "path-function-precedence", args: ["-c", 'tool() { printf function; }; PATH=bin; tool'], files: { "bin/tool": tool } },
  { name: "path-missing", args: ["-c", 'PATH=missing; absent'] },
  { name: "path-empty-missing", args: ["-c", 'PATH=; absent'] },
  { name: "path-unset-missing", args: ["-c", 'unset PATH; absent'] },
  { name: "path-directory-only", args: ["-c", 'PATH=dir; tool'], files: { "dir/tool": { directory: true } } },
  { name: "path-denied", args: ["-c", 'PATH=deny; tool'], files: { "deny/tool": { ...tool, mode: 0o644 } } },
  { name: "path-unsupported-interpreter", args: ["-c", 'PATH=bad:bin; tool'], files: { "bad/tool": { text: "#!/missing\nprintf forbidden", mode: 0o755 }, "bin/tool": tool }, policyDifference: "Explicit virtual unsupported-interpreter diagnostic, not a kernel bad-interpreter diagnostic." },
  { name: "path-binary", args: ["-c", 'PATH=bad:bin; tool'], files: { "bad/tool": { bytes: [127, 69, 76, 70, 0, 255], mode: 0o755 }, "bin/tool": tool }, policyDifference: "Strict virtual binary-script diagnostic differs from native executable-format wording." },
];
