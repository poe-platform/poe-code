export interface Fixture {
  readonly path: string;
  readonly body?: string;
  readonly hex?: string;
  readonly mode?: number;
  readonly directory?: boolean;
  readonly link?: string;
}

export interface InvocationCase {
  readonly id: string;
  readonly source: string;
  readonly stdin?: string;
  readonly stdinHex?: string;
  readonly chunkBytes?: number;
  readonly fixtures?: readonly Fixture[];
  readonly diagnostic?: readonly string[];
  readonly scope?: "policy" | "posix-limit";
  readonly policyStatus?: number;
}

const positional = `printf "<%s>|%s\\n" "$0" "$#"; printf "[%s]\\n" "$@"`;
const tool = (path: string, label = "tool", mode = 0o755): Fixture => ({
  path, mode, body: `#!{{bash}}\nprintf '${label}:%s\\n' "$@"\n`,
});

export const cases: readonly InvocationCase[] = [
  ...["bash", "sh"].flatMap((role): InvocationCase[] => [
    { id: `${role}-c-missing`, source: `${role} -c`, diagnostic: ["-c", "argument"] },
    { id: `${role}-c-empty`, source: `${role} -c ''` },
    { id: `${role}-c-name-omitted`, source: `${role} -c '${positional}'` },
    ...["", "two words", "-dash"].map((name, index): InvocationCase => ({
      id: `${role}-c-literal-args-${index}`,
      source: `${role} -c '${positional}' '${name}' '' 'a b' '*;$(false)' '-n'`,
    })),
    { id: `${role}-c-shift-function`, source: `${role} -c 'f() { shift; printf "f:%s:%s:%s\\n" "$0" "$#" "$1"; }; f x y; printf "p:%s:%s:%s\\n" "$0" "$#" "$1"; shift; printf "s:%s:%s\\n" "$#" "$1"' label A B` },
    { id: `${role}-stdin-flagless`, source: role, stdin: `${positional}\n` },
    { id: `${role}-stdin-s-args`, source: `${role} -s -- '' 'a b' '-n'`, stdin: `${positional}\n` },
    { id: `${role}-stdin-double-dash`, source: `${role} --`, stdin: "printf 'end-options\\n'\n" },
    { id: `${role}-stdin-single-dash`, source: `${role} -`, stdin: "printf 'single-dash\\n'\n" },
    { id: `${role}-read-same-chunk`, source: `${role} -s`, stdin: 'read value\ncommand data\nprintf "read:<%s>\\n" "$value"\n' },
  ]),
  { id: "c-stdin-data-not-source", source: `bash -c 'read value; printf "data:<%s>\\n" "$value"'`, stdin: "literal ; command\n" },
  { id: "stdin-binary-cat-same-chunk", source: "bash -s", stdinHex: Buffer.concat([Buffer.from("cat\n"), Buffer.from([0, 255, 10, 195, 169, 0, 127])]).toString("hex") },
  { id: "stdin-utf8-byte-chunks", source: "bash -s", stdin: "printf 'é😀\\n'\nprintf 'tail\\n'\n", chunkBytes: 1 },
  { id: "stdin-heredoc-read-same-cursor", source: "bash -s", stdin: 'cat <<EOF\nhere é\nEOF\nread value\npayload\nprintf "after:%s\\n" "$value"\n' },
  { id: "stdin-multiline-compound", source: "bash -s", stdin: 'if true; then\nread value\nprintf "unit:%s\\n" "$value"\nfi\nunit data\nprintf "next\\n"\n' },
  { id: "stdin-escaped-newline", source: "bash -s", stdin: "printf '%s\\n' hel\\\nlo\n" },
  { id: "stdin-eof-syntax-prior-effects", source: "bash -s", stdin: "printf 'before\\n'\nprintf 'file-effect\\n' >effect\nif true; then\n", diagnostic: ["syntax", "end of file"] },
  { id: "stdin-nested-interpreter", source: "bash -s", stdin: "bash -s\nprintf 'nested\\n'\n" },
  { id: "stdin-parent-residual", source: 'bash -s; read remaining; printf "parent:%s\\n" "$remaining"', stdin: 'printf "child\\n"\nexit\nremaining data\n' },
  { id: "child-environment-isolation", source: `private=hidden; export shared=outer; privateFn() { printf 'leak\\n'; }; bash -c 'printf "<%s>|%s\\n" "$private" "$shared"; shared=child; private=child; privateFn' ; printf 'parent:%s:%s\\n' "$private" "$shared"`, diagnostic: ["privateFn", "not found"] },
  { id: "child-cwd-options-exit", source: `set -o pipefail; bash -c 'cd sub; false | true; printf "child:%s\\n" "$?"; exit 7'; printf 'status:%s\\n' "$?"; cat marker; false | true; printf 'parent:%s\\n' "$?"`, fixtures: [{ path: "sub", directory: true }, { path: "marker", body: "root\n" }, { path: "sub/marker", body: "child\n" }] },
  { id: "child-descriptors", source: `bash -c 'printf "out\\n"; printf "err\\n" >&2; printf "fd3\\n" >&3' 3>fd-output; cat fd-output` },
  { id: "sh-posix-special-assignment", source: `sh -c 'value=before; value=after :; printf "%s\\n" "$value"'`, scope: "posix-limit" },
  { id: "path-prefix-environment", source: `PATH=tools invtool '' 'a b'; printf 'parent-path:%s\\n' "$PATH"`, fixtures: [tool("tools/invtool")] },
  { id: "path-empty", source: "PATH=''; invtool", fixtures: [tool("invtool")] },
  { id: "path-unset-current-directory", source: "unset PATH; invocation_unique_missing_826", fixtures: [tool("invocation_unique_missing_826")] },
  { id: "path-colon-relative", source: "PATH=missing::tools; invtool x", fixtures: [tool("invtool", "local"), tool("tools/invtool", "later")] },
  { id: "path-cwd-spaces", source: "PATH='tool dir'; invtool before; cd sub; invtool after", fixtures: [tool("tool dir/invtool", "root"), tool("sub/tool dir/invtool", "sub")] },
  { id: "path-first-usable", source: "PATH=first:second; invtool value", fixtures: [tool("first/invtool", "first"), tool("second/invtool", "second")] },
  { id: "path-directory-then-executable", source: "PATH=first:second; invtool value", fixtures: [{ path: "first/invtool", directory: true }, tool("second/invtool", "later")] },
  { id: "path-denied-file-then-executable", source: "PATH=first:second; invtool value", fixtures: [tool("first/invtool", "denied", 0o644), tool("second/invtool", "later")] },
  { id: "path-denied-directory-then-executable", source: "PATH=first:second; invtool value", fixtures: [tool("first/invtool", "denied"), { path: "first", directory: true, mode: 0 }, tool("second/invtool", "later")] },
  { id: "path-only-denied-126", source: "PATH=first; invtool", fixtures: [tool("first/invtool", "denied", 0o644)], diagnostic: ["invtool", "ermission denied"] },
  { id: "path-missing-127", source: "PATH=missing; invocation_unique_missing_826", diagnostic: ["invocation_unique_missing_826", "not found"] },
  { id: "path-symlink", source: "PATH=links; invtool linked", fixtures: [tool("real/tool"), { path: "links/invtool", link: "../real/tool" }] },
  { id: "path-direct-bypasses-search", source: "PATH=wrong; ./direct/invtool literal", fixtures: [tool("direct/invtool", "direct"), tool("wrong/invtool", "wrong")] },
  { id: "path-function-builtin-precedence", source: `PATH=tools; invtool() { printf 'function\\n'; }; invtool; printf 'builtin\\n'`, fixtures: [tool("tools/invtool", "file"), tool("tools/printf", "file")] },
  { id: "path-command-v", source: "PATH=tools; command -v invtool", fixtures: [tool("tools/invtool")] },
  { id: "path-type", source: "PATH=tools; type invtool", fixtures: [tool("tools/invtool")] },
  { id: "path-headerless-policy", source: "PATH=tools; invtool", fixtures: [{ path: "tools/invtool", body: "printf 'native-fallback\\n'\n", mode: 0o755 }] },
  { id: "path-unsupported-shebang-policy", source: "PATH=tools; invtool", fixtures: [{ path: "tools/invtool", body: "#!/definitely/unavailable/interpreter\nprintf 'never\\n'\n", mode: 0o755 }], scope: "policy", policyStatus: 126 },
  { id: "path-binary-policy", source: "PATH=tools; invtool", fixtures: [{ path: "tools/invtool", hex: "7f454c460002ff", mode: 0o755 }], scope: "policy", policyStatus: 126 },
  { id: "path-invalid-utf8-policy", source: "PATH=tools; invtool", fixtures: [{ path: "tools/invtool", body: "#!{{bash}}\n", hex: "fffe", mode: 0o755 }], scope: "policy", policyStatus: 126 },
];
