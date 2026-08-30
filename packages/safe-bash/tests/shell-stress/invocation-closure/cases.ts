import type { Fixture } from "../invocation-modes/cases.js";

export interface ClosureCase {
  readonly id: string;
  readonly group: "discovery" | "read-N" | "posix";
  readonly role?: "bash" | "sh";
  readonly entry?: "c" | "stdin" | "file";
  readonly source: string;
  readonly stdin?: string;
  readonly stdinHex?: string;
  readonly chunkBytes?: number;
  readonly locale?: "C" | "en_US.UTF-8";
  readonly fixtures?: readonly Fixture[];
  readonly diagnostic?: readonly string[];
  readonly optionProbe?: boolean;
}

const tool = (path: string, label = "file", mode = 0o755): Fixture => ({ path, mode, body: `#!{{bash}}\nprintf '${label}:<%s>\\n' "$@"\n` });
const assignment = 'value=before; value=special :; printf "special:%s\\n" "$value"; value=ordinary true; printf "ordinary:%s\\n" "$value"; closurefn() { printf "inside:%s\\n" "$value"; }; value=function closurefn; printf "function:%s\\n" "$value"';

export const cases: readonly ClosureCase[] = [
  { id: "query-v-multiple-status", group: "discovery", source: 'command -v printf closure_missing; printf "first:%s\\n" "$?"; command -v closure_missing printf; printf "second:%s\\n" "$?"; command -v closure_missing; printf "none:%s\\n" "$?"' },
  { id: "query-V-verbose", group: "discovery", source: 'closurefn() { :; }; PATH=tools; command -V printf closurefn closuretool', fixtures: [tool("tools/closuretool")] },
  { id: "type-multiple-status", group: "discovery", source: 'closurefn() { :; }; PATH=tools; type -t printf closurefn closuretool closure_missing; printf "mixed:%s\\n" "$?"; type printf closuretool', fixtures: [tool("tools/closuretool")] },
  { id: "type-option-combinations", group: "discovery", optionProbe: true, source: 'closuretool() { :; }; PATH=first:second; type -at closuretool; type -ap closuretool; type -P closuretool; type -ft closuretool', fixtures: [tool("first/closuretool"), tool("second/closuretool")] },
  { id: "command-bypasses-function", group: "discovery", source: 'closuretool() { printf "function\\n"; }; PATH=tools; command -v closuretool; closuretool; command closuretool "" "a b" "*;literal"; command command printf "builtin\\n"', fixtures: [tool("tools/closuretool")] },
  { id: "query-effective-path-cwd", group: "discovery", source: 'PATH=missing; PATH="tool dir" command -v closuretool; PATH="tool dir" command closuretool prefix; cd sub; PATH="tool dir" command -v closuretool; PATH="tool dir" command closuretool child', fixtures: [tool("tool dir/closuretool", "root"), tool("sub/tool dir/closuretool", "sub")] },
  { id: "query-denied-directory-symlink", group: "discovery", source: 'PATH=denied:directory:links; command -v closuretool; type -t closuretool; command closuretool yes; command -v ./real/tool; command ./real/tool direct', fixtures: [tool("denied/closuretool", "denied", 0o644), { path: "directory/closuretool", directory: true }, { path: "links/closuretool", link: "../real/tool" }, tool("real/tool")] },
  { id: "query-empty-and-unsupported-option", group: "discovery", optionProbe: true, source: 'command; printf "empty:%s\\n" "$?"; command -z printf; printf "bad:%s\\n" "$?"', diagnostic: ["command", "invalid option"] },
  ...(["en_US.UTF-8", "C"] as const).map((locale): ClosureCase => ({ id: `read-N-character-count-${locale}`, group: "read-N", locale, chunkBytes: 1, source: 'read -r -N 2 value; printf "first:%s:<%s>\\n" "$?" "$value"; read -r rest; printf "rest:%s:<%s>\\n" "$?" "$rest"', stdin: "éXtail\n" })),
  { id: "read-N-delimiter-vs-n", group: "read-N", source: 'read -r -N 3 -d : first; printf "N:%s:<%s>\\n" "$?" "$first"; read -r -n 3 -d : second; printf "n:%s:<%s>\\n" "$?" "$second"; read -r rest; printf "rest:<%s>\\n" "$rest"', stdin: "A\nBC:D\n" },
  { id: "read-N-skips-nul-data", group: "read-N", source: 'read -r -N 3 value; printf "value:%s:<%s>\\n" "$?" "$value"; read -r rest; printf "rest:<%s>\\n" "$rest"', stdinHex: "4100420a7461696c0a" },
  { id: "read-N-nul-delimiter", group: "read-N", source: 'read -r -N 3 -d "" value; printf "value:%s:<%s>\\n" "$?" "$value"; read -r rest; printf "rest:<%s>\\n" "$rest"', stdinHex: "410042437461696c0a" },
  { id: "read-N-no-ifs-split", group: "read-N", source: 'IFS=:; read -r -N 4 first second; printf "value:%s:<%s>:<%s>\\n" "$?" "$first" "$second"; read -r rest; printf "rest:<%s>\\n" "$rest"', stdin: "a:b:rest\n" },
  { id: "read-N-backslash-raw", group: "read-N", chunkBytes: 1, source: 'read -N 3 cooked; printf "cooked:%s:<%s>\\n" "$?" "$cooked"; read -r -N 3 raw; printf "raw:%s:<%s>\\n" "$?" "$raw"; read -r rest; printf "rest:<%s>\\n" "$rest"', stdin: "a\\\nbc\\xyrest\n" },
  { id: "read-N-zero-invalid", group: "read-N", source: 'value=old; read -N 0 value; printf "zero:%s:<%s>\\n" "$?" "$value"; read -N -1 value; printf "negative:%s\\n" "$?"; read -N bad value; printf "invalid:%s\\n" "$?"; read -r value; printf "remaining:<%s>\\n" "$value"', stdin: "untouched\n", diagnostic: ["read", "invalid"] },
  { id: "read-N-eof-partial", group: "read-N", locale: "en_US.UTF-8", chunkBytes: 1, source: 'read -r -N 5 value; printf "partial:%s:<%s>\\n" "$?" "$value"; read -r -N 1 next; printf "next:%s:<%s>\\n" "$?" "$next"', stdin: "é" },
  { id: "read-N-stdin-source-cursor", group: "read-N", entry: "stdin", locale: "en_US.UTF-8", source: 'read -r -N 2 value\néΩprintf "cursor:<%s>\\n" "$value"\nprintf "next-source\\n"\n' },
  { id: "bash-special-ordinary-function", group: "posix", role: "bash", source: assignment },
  { id: "sh-special-ordinary-function", group: "posix", role: "sh", source: assignment },
  { id: "sh-command-special-prefix", group: "posix", role: "sh", source: 'value=before; value=after command :; printf "command:%s\\n" "$value"; value=direct :; printf "direct:%s\\n" "$value"; value=again command command :; printf "twice:%s\\n" "$value"' },
  { id: "sh-special-export-set-shift-unset", group: "posix", role: "sh", source: 'value=one export child=shown; printf "%s:%s\\n" "$value" "$child"; value=two set -- A B; printf "%s:%s\\n" "$value" "$#"; value=three shift; printf "%s:%s\\n" "$value" "$1"; value=four unset child; printf "%s:<%s>\\n" "$value" "$child"' },
  { id: "sh-file-profile", group: "posix", role: "sh", entry: "file", source: 'value=before; value=after :; printf "file:%s\\n" "$value"\n' },
  { id: "sh-stdin-profile", group: "posix", role: "sh", entry: "stdin", source: 'value=before\nvalue=after :\nprintf "stdin:%s\\n" "$value"\n' },
  { id: "sh-nested-bash-resets-sh-inherits", group: "posix", role: "sh", source: 'export value=parent; {{bash}} -c \'value=child :; printf "bash:%s\\n" "$value"\'; {{sh}} -c \'value=child :; printf "sh:%s\\n" "$value"\'; printf "parent:%s\\n" "$value"' },
  { id: "sh-special-exported-environment", group: "posix", role: "sh", source: 'value=before; value=after :; {{bash}} -c \'printf "child:<%s>\\n" "$value"\'; printf "parent:%s\\n" "$value"; value=temporary command printf "ordinary\\n"; printf "after-command:%s\\n" "$value"' },
];

export const hostCases = [
  "host-registry-interpreter-discovery", "host-command-invoke-middleware-origin", "host-command-shared-budget",
  "host-discovery-permission-cache-host-leak", "host-read-N-cancel-partial-character", "host-query-cancel-late-rejection",
  "host-sh-profile-never-global", "host-unknown-permission-discovery",
] as const;
