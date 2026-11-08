export interface NativeCase {
  readonly id: string;
  readonly alias: "egrep" | "fgrep";
  readonly args: readonly string[];
  readonly stdin: string;
  readonly files: Readonly<Record<string, string>>;
  readonly qualification?: string;
  readonly product?: { readonly code: number; readonly stdout: string; readonly stderr: string };
}

export const nativeCases: readonly NativeCase[] = (["egrep", "fgrep"] as const).flatMap(alias => {
  const files = { data: "cat\ndog\na.b\naxb\n", other: "no\ncat\n", patterns: "cat\ndog\n", empty: "", "a b": "$(touch /escape); * [x]\n" };
  const common = [
    { id: "default-mode", args: [alias === "egrep" ? "cat|dog" : "a.b"], stdin: files.data },
    { id: "repeated-mode", args: [alias === "egrep" ? "-E" : "-F", "cat"], stdin: files.data },
    { id: "line-count", args: ["-c", "cat"], stdin: files.data },
    { id: "invert-number", args: ["-vn", "cat"], stdin: files.data },
    { id: "case-word", args: ["-iw", "cat"], stdin: "CAT cat1 cat!\nno\n" },
    { id: "whole-only", args: ["-xo", "cat"], stdin: "cat\ncat dog\n" },
    { id: "max-count", args: ["-m1", "cat"], stdin: "cat\ncat\n" },
    { id: "unterminated", args: ["cat"], stdin: "no\ncat" },
    { id: "no-match", args: ["absent"], stdin: files.data },
    { id: "empty-input", args: ["cat"], stdin: "" },
    { id: "multiple-files", args: ["-n", "cat", "data", "other"], stdin: "" },
    { id: "mixed-stdin-file", args: ["cat", "data", "-"], stdin: "cat\n" },
    { id: "pattern-file", args: ["-f", "patterns", "data"], stdin: "" },
    { id: "stdin-pattern-file", args: ["-f", "-", "data"], stdin: "cat\n" },
    { id: "empty-pattern-file", args: ["-f", "empty", "data"], stdin: "" },
    { id: "multiple-patterns", args: ["-e", "cat", "-e", "dog", "data"], stdin: "" },
    { id: "files-with-match", args: ["-l", "cat", "data", "other"], stdin: "" },
    { id: "silent-missing", args: ["-s", "cat", "missing"], stdin: "" },
    { id: "quiet-before-missing", args: ["-q", "cat", "data", "missing"], stdin: "" },
    { id: "dash-pattern-literal", args: ["--", "-F"], stdin: "-F\nno\n" },
    { id: "literal-argv", args: ["-F", "-x", "--", "$(touch /escape); * [x]", "a b"], stdin: "" },
  ].filter(fixture => fixture.id !== "literal-argv" || alias === "fgrep");
  return [
    ...common.map(fixture => ({ ...fixture, id: `${alias}-${fixture.id}`, alias, files })),
    {
      id: `${alias}-conflicting-mode`, alias, args: [alias === "egrep" ? "-F" : "-E", "cat"], stdin: "cat\n", files,
      qualification: "Bounded grep rejects combined E/F; native alias flag precedence is a separate profile.",
      product: { code: 2, stdout: "", stderr: `${alias}: conflicting matchers specified\n` },
    },
    {
      id: `${alias}-missing-pattern`, alias, args: [], stdin: "", files,
      qualification: "Bounded grep emits a short alias-prefixed usage error, not native help text.",
      product: { code: 2, stdout: "", stderr: `${alias}: missing pattern\n` },
    },
    {
      id: `${alias}-unsupported-G`, alias, args: ["-G", "cat"], stdin: "cat\n", files,
      qualification: "Bounded grep does not implement -G, including alias matcher reset.",
      product: { code: 2, stdout: "", stderr: `${alias}: invalid option -- 'G'\n` },
    },
    {
      id: `${alias}-invalid-option`, alias, args: ["--not-supported", "cat"], stdin: "cat\n", files,
      qualification: "Native usage formatting and program prefixes differ; raw diagnostics are retained.",
      product: { code: 2, stdout: "", stderr: `${alias}: unrecognized option '--not-supported'\n` },
    },
    ...(alias === "egrep" ? [{
      id: "egrep-ordered-alternative", alias, args: ["-o", "a|ab"], stdin: "ab\n", files,
      qualification: "Existing bounded engine uses ordered alternatives, not POSIX leftmost-longest.",
      product: { code: 0, stdout: "a\n", stderr: "" },
    }] : []),
  ];
});
