export interface ClosureCase {
  readonly name: string;
  readonly source: string;
  readonly stdin?: string;
  readonly locale?: string;
  readonly files?: Readonly<Record<string, { readonly text: string; readonly mode: number }>>;
}

export const discoveryCases: readonly ClosureCase[] = [
  { name: "builtin discovery", source: "command -v true false read command type; type -t true false read command type" },
  { name: "verbose discovery", source: "command -V true false; type true false" },
  { name: "mixed status", source: 'command -v missing true absent; printf "v:%s\\n" "$?"; type -t missing true absent; printf "t:%s\\n" "$?"' },
  { name: "missing verbose", source: "type missing; command -V absent" },
  { name: "empty invocations", source: 'command; command -v; command -V; type; printf "%s\\n" "$?"' },
  { name: "function precedence", source: 'true() { printf "function\\n"; }; true; command true; type -t true; command -v true' },
  { name: "function definition", source: "fun() { printf '%s\\n' \"$1\"; :; }; type fun; command -V fun" },
  { name: "function bypass", source: 'false() { return 0; }; false; printf "%s\\n" "$?"; command false; printf "%s\\n" "$?"; command command false' },
  { name: "type options", source: "true() { :; }; type -at true; type -ft true; type -p true; type -P true; type -tp true; type -pt true" },
  { name: "option ordering", source: "command -vV true; command -Vv true; type -t -p true; type -p -t true" },
  { name: "literal terminator", source: "command -- true; command -v -- true; type -t -- true" },
  { name: "command assignment isolation", source: 'VALUE=old; VALUE=new command export TEMP=ok; printf "%s:%s\\n" "$VALUE" "$TEMP"' },
  { name: "path candidate", source: "PATH=bin; command -v tool; type tool; type -t tool; type -p tool; command tool hi", files: { "bin/tool": { text: '#!/bin/bash\nprintf "tool:%s\\n" "$1"\n', mode: 0o755 } } },
  { name: "spaces and empty path", source: "PATH=; command -v 'a b'; type 'a b'; command 'a b'", files: { "a b": { text: '#!/bin/bash\nprintf "space\\n"\n', mode: 0o755 } } },
  { name: "multiple paths", source: "PATH=one:two; type -ap tool; type -aP tool; command -v tool; command tool", files: { "one/tool": { text: '#!/bin/bash\nprintf "one\\n"\n', mode: 0o755 }, "two/tool": { text: '#!/bin/bash\nprintf "two\\n"\n', mode: 0o755 } } },
  { name: "prefix path", source: "PATH=none; PATH=bin command -v tool; command -v tool; PATH=bin command tool", files: { "bin/tool": { text: '#!/bin/bash\nprintf "prefix\\n"\n', mode: 0o755 } } },
  { name: "local path", source: 'PATH=none; fun() { local PATH=bin; command -v tool; command tool; }; fun; command -v tool; printf "%s\\n" "$?"', files: { "bin/tool": { text: '#!/bin/bash\nprintf "local\\n"\n', mode: 0o755 } } },
  { name: "cwd refresh", source: "PATH=.; command -v tool; cd sub; command -v tool; command tool", files: { "tool": { text: '#!/bin/bash\nprintf "outer\\n"\n', mode: 0o755 }, "sub/tool": { text: '#!/bin/bash\nprintf "inner\\n"\n', mode: 0o755 } } },
];
