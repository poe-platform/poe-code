export const handoffFiles = {
  "child.sh": "#!/bin/sh\nprintf '%s\\000' \"$0\" \"$#\" \"$@\"\n",
  "env-child.sh": "#!/usr/bin/env sh\nprintf '%s\\000' \"$0\" \"$#\" \"$@\"\n"
} as const;

export const handoffCases = [
  {
    "name": "literal-parameter",
    "script": "raw=$'\\200'; other=$'\\377'; code=$(printf 'cat <<${x%s}\nsafe\n${x%s}\n' \"$raw\" \"$raw\"); eval \"$code\"\n",
    "status": 0,
    "stdoutHex": "736166650a",
    "stderrHex": ""
  },
  {
    "name": "literal-substitution",
    "script": "raw=$'\\200'; other=$'\\377'; code=$(printf 'cat <<$(x%s)\nsafe\n$(x%s)\n' \"$raw\" \"$raw\"); eval \"$code\"\n",
    "status": 0,
    "stdoutHex": "736166650a",
    "stderrHex": ""
  },
  {
    "name": "literal-backtick",
    "script": "raw=$'\\200'; other=$'\\377'; code=$(printf 'cat <<`x%s`\nsafe\n`x%s`\n' \"$raw\" \"$raw\"); eval \"$code\"\n",
    "status": 0,
    "stdoutHex": "736166650a",
    "stderrHex": ""
  },
  {
    "name": "nested-tabstrip-offset",
    "script": "raw=$'\\200'; other=$'\\377'; code=$(printf 'prefix=\"é🙂\"; got=$(cat <<-'\\''%s'\\''\n\t%s\n\t%s\n); printf '\\''%%s'\\'' \"$got\"\n' \"$raw\" \"$other\" \"$raw\"); eval \"$code\"\n",
    "status": 0,
    "stdoutHex": "ff",
    "stderrHex": ""
  },
  {
    "name": "function-after-eval-close",
    "script": "raw=$'\\200'; other=$'\\377'; code=$(printf 'later(){ printf '\\''%%s'\\'' '\\''%s'\\''; }\n' \"$raw\"); eval \"$code\"\nunset code raw; later\n",
    "status": 0,
    "stdoutHex": "80",
    "stderrHex": ""
  },
  {
    "name": "function-document-after-eval-close",
    "script": "raw=$'\\200'; other=$'\\377'; code=$(printf 'later(){ cat <<'\\''END'\\''\n%s\nEND\n}\n' \"$other\"); eval \"$code\"\nunset code other; later\n",
    "status": 0,
    "stdoutHex": "ff0a",
    "stderrHex": ""
  },
  {
    "name": "brace-replay-raw-fields",
    "script": "raw=$'\\200'; other=$'\\377'; printf '%s\\000' {left,right}\"$raw\"\n",
    "status": 0,
    "stdoutHex": "6c656674800072696768748000",
    "stderrHex": ""
  },
  {
    "name": "brace-replay-declare-assignment",
    "script": "raw=$'\\200'; other=$'\\377'; declare value={left,right}\"$raw\"; printf '%s\\000' \"$value\"\n",
    "status": 0,
    "stdoutHex": "72696768748000",
    "stderrHex": ""
  },
  {
    "name": "sh-file",
    "script": "raw=$'\\200'; other=$'\\377'; sh child.sh \"$raw\" \"\" \"$other\" é\n",
    "status": 0,
    "stdoutHex": "6368696c642e7368003400800000ff00c3a900",
    "stderrHex": ""
  },
  {
    "name": "sh-file-options",
    "script": "raw=$'\\200'; other=$'\\377'; sh -e -- child.sh \"$raw\" \"\" \"$other\" é\n",
    "status": 0,
    "stdoutHex": "6368696c642e7368003400800000ff00c3a900",
    "stderrHex": ""
  },
  {
    "name": "sh-command-string",
    "script": "raw=$'\\200'; other=$'\\377'; sh -c 'printf \"%s\\000\" \"$0\" \"$#\" \"$@\"' named \"$raw\" \"\" \"$other\" é\n",
    "status": 0,
    "stdoutHex": "6e616d6564003400800000ff00c3a900",
    "stderrHex": ""
  },
  {
    "name": "bash-command-string",
    "script": "raw=$'\\200'; other=$'\\377'; bash +B -c 'printf \"%s\\000\" \"$0\" \"$#\" \"$@\"' named \"$raw\" \"\" \"$other\" é\n",
    "status": 0,
    "stdoutHex": "6e616d6564003400800000ff00c3a900",
    "stderrHex": ""
  },
  {
    "name": "sh-raw-zero",
    "script": "raw=$'\\200'; other=$'\\377'; sh -c 'printf \"%s\\000\" \"$0\" \"$1\"' \"$raw\" \"$other\"\n",
    "status": 0,
    "stdoutHex": "8000ff00",
    "stderrHex": ""
  },
  {
    "name": "bash-raw-zero",
    "script": "raw=$'\\200'; other=$'\\377'; bash -c 'printf \"%s\\000\" \"$0\" \"$1\"' \"$raw\" \"$other\"\n",
    "status": 0,
    "stdoutHex": "8000ff00",
    "stderrHex": ""
  },
  {
    "name": "direct-shebang",
    "script": "raw=$'\\200'; other=$'\\377'; ./child.sh \"$raw\" \"\" \"$other\" é\n",
    "status": 0,
    "stdoutHex": "2e2f6368696c642e7368003400800000ff00c3a900",
    "stderrHex": ""
  },
  {
    "name": "direct-env-shebang",
    "script": "raw=$'\\200'; other=$'\\377'; ./env-child.sh \"$raw\" \"\" \"$other\" é\n",
    "status": 0,
    "stdoutHex": "2e2f656e762d6368696c642e7368003400800000ff00c3a900",
    "stderrHex": ""
  },
  {
    "name": "env-forwarding",
    "script": "raw=$'\\200'; other=$'\\377'; env MARK=okay sh -- child.sh \"$raw\" \"\" \"$other\" é\n",
    "status": 0,
    "stdoutHex": "6368696c642e7368003400800000ff00c3a900",
    "stderrHex": ""
  },
  {
    "name": "xargs-forwarding",
    "script": "raw=$'\\200'; other=$'\\377'; printf '%s\\000' \"$raw\" '' \"$other\" é | xargs -0 sh child.sh\n",
    "status": 0,
    "stdoutHex": "6368696c642e7368003400800000ff00c3a900",
    "stderrHex": ""
  }
] as const;
