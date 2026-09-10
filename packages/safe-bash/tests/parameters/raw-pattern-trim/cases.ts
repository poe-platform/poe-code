export const cases = [
  {
    "name": "prefix-short",
    "locale": "C",
    "script": "value=$'\\377a\\377a\\377'; printf '%s' \"${value#*a}\"",
    "status": 0,
    "stdoutHex": "ff61ff",
    "stderrHex": ""
  },
  {
    "name": "prefix-long",
    "locale": "C",
    "script": "value=$'\\377a\\377a\\377'; printf '%s' \"${value##*a}\"",
    "status": 0,
    "stdoutHex": "ff",
    "stderrHex": ""
  },
  {
    "name": "suffix-short",
    "locale": "C",
    "script": "value=$'\\377a\\377a\\377'; printf '%s' \"${value%a*}\"",
    "status": 0,
    "stdoutHex": "ff61ff",
    "stderrHex": ""
  },
  {
    "name": "suffix-long",
    "locale": "C",
    "script": "value=$'\\377a\\377a\\377'; printf '%s' \"${value%%a*}\"",
    "status": 0,
    "stdoutHex": "ff",
    "stderrHex": ""
  },
  {
    "name": "mixed-prefix",
    "locale": "C",
    "script": "value=$'\\303\\251\\377\\360\\237\\231\\202'; printf '%s' \"${value#?}\"",
    "status": 0,
    "stdoutHex": "a9fff09f9982",
    "stderrHex": ""
  },
  {
    "name": "mixed-suffix",
    "locale": "C",
    "script": "value=$'\\303\\251\\377\\360\\237\\231\\202'; printf '%s' \"${value%?}\"",
    "status": 0,
    "stdoutHex": "c3a9fff09f99",
    "stderrHex": ""
  },
  {
    "name": "valid-prefix",
    "locale": "C",
    "script": "value=$'\\303\\251\\360\\237\\231\\202'; printf '%s' \"${value#?}\"",
    "status": 0,
    "stdoutHex": "a9f09f9982",
    "stderrHex": ""
  },
  {
    "name": "raw-pattern",
    "locale": "C",
    "script": "value=$'\\376\\377'; pattern=$'\\377'; printf '%s' \"${value%$pattern}\"",
    "status": 0,
    "stdoutHex": "fe",
    "stderrHex": ""
  },
  {
    "name": "distinct-invalid",
    "locale": "C",
    "script": "value=$'\\377'; pattern=$'\\376'; printf '%s' \"${value%$pattern}\"",
    "status": 0,
    "stdoutHex": "ff",
    "stderrHex": ""
  },
  {
    "name": "replacement-distinct",
    "locale": "C",
    "script": "value=$'\\377'; pattern=$'\\357\\277\\275'; printf '%s' \"${value%$pattern}\"",
    "status": 0,
    "stdoutHex": "ff",
    "stderrHex": ""
  },
  {
    "name": "quoted-wildcard",
    "locale": "C",
    "script": "value=$'*\\377*'; printf '%s' \"${value#\"*\"}\"",
    "status": 0,
    "stdoutHex": "ff2a",
    "stderrHex": ""
  },
  {
    "name": "indexed",
    "locale": "C",
    "script": "value=($'\\377.' $'\\376.'); printf '%s|' \"${value[0]%.}\" \"${value[1]%.}\"",
    "status": 0,
    "stdoutHex": "ff7cfe7c",
    "stderrHex": ""
  },
  {
    "name": "members",
    "locale": "C",
    "script": "value=($'\\377.' $'\\376.'); printf '%s|' \"${value[@]%.}\"",
    "status": 0,
    "stdoutHex": "ff7cfe7c",
    "stderrHex": ""
  },
  {
    "name": "positional",
    "locale": "C",
    "script": "set -- $'\\377.'; printf '%s' \"${1%.}\"",
    "status": 0,
    "stdoutHex": "ff",
    "stderrHex": ""
  },
  {
    "name": "associative",
    "locale": "C",
    "script": "declare -A value; value[key]=$'\\377.'; printf '%s' \"${value[key]%.}\"",
    "status": 0,
    "stdoutHex": "ff",
    "stderrHex": ""
  },
  {
    "name": "class-invalid",
    "locale": "C",
    "script": "value=$'\\377.'; printf '%s' \"${value#[[:alpha:]]}\"",
    "status": 0,
    "stdoutHex": "ff2e",
    "stderrHex": ""
  },
  {
    "name": "prefix-short",
    "locale": "C.UTF-8",
    "script": "value=$'\\377a\\377a\\377'; printf '%s' \"${value#*a}\"",
    "status": 0,
    "stdoutHex": "ff61ff",
    "stderrHex": ""
  },
  {
    "name": "prefix-long",
    "locale": "C.UTF-8",
    "script": "value=$'\\377a\\377a\\377'; printf '%s' \"${value##*a}\"",
    "status": 0,
    "stdoutHex": "ff",
    "stderrHex": ""
  },
  {
    "name": "suffix-short",
    "locale": "C.UTF-8",
    "script": "value=$'\\377a\\377a\\377'; printf '%s' \"${value%a*}\"",
    "status": 0,
    "stdoutHex": "ff61ff",
    "stderrHex": ""
  },
  {
    "name": "suffix-long",
    "locale": "C.UTF-8",
    "script": "value=$'\\377a\\377a\\377'; printf '%s' \"${value%%a*}\"",
    "status": 0,
    "stdoutHex": "ff",
    "stderrHex": ""
  },
  {
    "name": "mixed-prefix",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\360\\237\\231\\202'; printf '%s' \"${value#?}\"",
    "status": 0,
    "stdoutHex": "a9fff09f9982",
    "stderrHex": ""
  },
  {
    "name": "mixed-suffix",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\360\\237\\231\\202'; printf '%s' \"${value%?}\"",
    "status": 0,
    "stdoutHex": "c3a9fff09f99",
    "stderrHex": ""
  },
  {
    "name": "valid-prefix",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\360\\237\\231\\202'; printf '%s' \"${value#?}\"",
    "status": 0,
    "stdoutHex": "f09f9982",
    "stderrHex": ""
  },
  {
    "name": "raw-pattern",
    "locale": "C.UTF-8",
    "script": "value=$'\\376\\377'; pattern=$'\\377'; printf '%s' \"${value%$pattern}\"",
    "status": 0,
    "stdoutHex": "fe",
    "stderrHex": ""
  },
  {
    "name": "distinct-invalid",
    "locale": "C.UTF-8",
    "script": "value=$'\\377'; pattern=$'\\376'; printf '%s' \"${value%$pattern}\"",
    "status": 0,
    "stdoutHex": "ff",
    "stderrHex": ""
  },
  {
    "name": "replacement-distinct",
    "locale": "C.UTF-8",
    "script": "value=$'\\377'; pattern=$'\\357\\277\\275'; printf '%s' \"${value%$pattern}\"",
    "status": 0,
    "stdoutHex": "ff",
    "stderrHex": ""
  },
  {
    "name": "quoted-wildcard",
    "locale": "C.UTF-8",
    "script": "value=$'*\\377*'; printf '%s' \"${value#\"*\"}\"",
    "status": 0,
    "stdoutHex": "ff2a",
    "stderrHex": ""
  },
  {
    "name": "indexed",
    "locale": "C.UTF-8",
    "script": "value=($'\\377.' $'\\376.'); printf '%s|' \"${value[0]%.}\" \"${value[1]%.}\"",
    "status": 0,
    "stdoutHex": "ff7cfe7c",
    "stderrHex": ""
  },
  {
    "name": "members",
    "locale": "C.UTF-8",
    "script": "value=($'\\377.' $'\\376.'); printf '%s|' \"${value[@]%.}\"",
    "status": 0,
    "stdoutHex": "ff7cfe7c",
    "stderrHex": ""
  },
  {
    "name": "positional",
    "locale": "C.UTF-8",
    "script": "set -- $'\\377.'; printf '%s' \"${1%.}\"",
    "status": 0,
    "stdoutHex": "ff",
    "stderrHex": ""
  },
  {
    "name": "associative",
    "locale": "C.UTF-8",
    "script": "declare -A value; value[key]=$'\\377.'; printf '%s' \"${value[key]%.}\"",
    "status": 0,
    "stdoutHex": "ff",
    "stderrHex": ""
  },
  {
    "name": "class-invalid",
    "locale": "C.UTF-8",
    "script": "value=$'\\377.'; printf '%s' \"${value#[[:alpha:]]}\"",
    "status": 0,
    "stdoutHex": "ff2e",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-#-?",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value#?}\"",
    "status": 0,
    "stdoutHex": "a9ffc3a9",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-#-??",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value#??}\"",
    "status": 0,
    "stdoutHex": "c3a9ffc3a9",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-#-*?",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value#*?}\"",
    "status": 0,
    "stdoutHex": "a9ffc3a9",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-#-?*",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value#?*}\"",
    "status": 0,
    "stdoutHex": "a9ffc3a9",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-##-?",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value##?}\"",
    "status": 0,
    "stdoutHex": "ffc3a9",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-##-??",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value##??}\"",
    "status": 0,
    "stdoutHex": "c3a9ffc3a9",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-##-*?",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value##*?}\"",
    "status": 0,
    "stdoutHex": "",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-##-?*",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value##?*}\"",
    "status": 0,
    "stdoutHex": "",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-%-?",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value%?}\"",
    "status": 0,
    "stdoutHex": "c3a9ffc3",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-%-??",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value%??}\"",
    "status": 0,
    "stdoutHex": "c3a9ffc3a9",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-%-*?",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value%*?}\"",
    "status": 0,
    "stdoutHex": "c3a9ffc3",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-%-?*",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value%?*}\"",
    "status": 0,
    "stdoutHex": "c3a9ffc3",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-%%-?",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value%%?}\"",
    "status": 0,
    "stdoutHex": "c3a9ff",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-%%-??",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value%%??}\"",
    "status": 0,
    "stdoutHex": "c3a9ffc3a9",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-%%-*?",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value%%*?}\"",
    "status": 0,
    "stdoutHex": "",
    "stderrHex": ""
  },
  {
    "name": "mixed-boundary-%%-?*",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\377\\303\\251'; printf '%s' \"${value%%?*}\"",
    "status": 0,
    "stdoutHex": "",
    "stderrHex": ""
  }
] as const;
