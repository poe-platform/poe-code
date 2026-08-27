export const discoveryFixCases = [
  { name: "relative-path", source: "PATH=tools; command -V closuretool; command -v closuretool; type closuretool; type -p closuretool" },
  { name: "absolute-path", source: 'PATH="$PWD/tools"; command -V closuretool; command -v closuretool; type closuretool' },
  { name: "empty-path", source: "PATH=; command -V localtool; command -v localtool; type localtool" },
  { name: "empty-component", source: "PATH=missing::tools; command -V localtool closuretool; command -v localtool closuretool; type localtool closuretool" },
  { name: "dot-path", source: "PATH=.; command -V localtool; command -v localtool; type localtool" },
  { name: "dot-slash-path", source: "PATH=./tools; command -V closuretool; command -v closuretool; type closuretool" },
  { name: "dot-preservation", source: "PATH=././tools; command -V closuretool" },
  { name: "parent-preservation", source: "PATH=tools/../tools; command -V closuretool; command -v closuretool; type closuretool" },
  { name: "slash-preservation", source: "PATH=tools//; command -V closuretool; command -v closuretool; type closuretool" },
  { name: "direct-relative", source: "PATH=missing; command -V tools/closuretool ./localtool; command -v tools/closuretool; type tools/closuretool" },
  { name: "direct-absolute", source: 'PATH=missing; command -V "$PWD/tools/closuretool"; command -v "$PWD/tools/closuretool"; type "$PWD/tools/closuretool"' },
  { name: "cwd-refresh", source: "PATH=tools; command -V closuretool; cd sub; command -V closuretool; command -v closuretool; type closuretool" },
  { name: "space-path-name", source: "PATH='space dir'; command -V 'space tool'; command -v 'space tool'; type 'space tool'" },
  { name: "symlink", source: "PATH=tools; command -V linktool; command -v linktool; type linktool" },
  { name: "prefix-path", source: "PATH=missing; PATH=tools command -V closuretool; command -v closuretool" },
  { name: "local-path", source: "PATH=missing; probe() { local PATH=tools; command -V closuretool; }; probe; command -v closuretool" },
  { name: "real-builtin", source: "PATH=; command -V true; command -v true; type true; type -t true" },
  { name: "combined-flags", source: "PATH=tools; command -vV closuretool true; command -Vv closuretool true; command -V -v closuretool; command -v -V closuretool" },
  { name: "terminator", source: "PATH=tools; command -V -- closuretool; command -v -- closuretool; command -- true; command -V -- -z" },
  { name: "empty-invocations", source: "command; command -v; command -V; command --" },
  { name: "unknown-z", source: "command -z true" },
  { name: "unknown-x", source: "command -x true" },
  { name: "unknown-combined", source: "command -vVz true" },
  { name: "unknown-first", source: "command -zv true" },
  { name: "unknown-long", source: "command --wat true" },
  { name: "unknown-line", source: ":\ncommand -z true" },
] as const;

export const discoveryFixFiles = [
  "tools/closuretool", "localtool", "sub/tools/closuretool", "space dir/space tool",
] as const;
export const discoveryFixFileText = "#!/bin/bash\nexit 23\n";
