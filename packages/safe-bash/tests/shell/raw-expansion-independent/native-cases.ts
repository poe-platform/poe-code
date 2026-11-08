export const nativeCases = [
  {
    "name": "trim-quoted-patterns",
    "locale": "C",
    "script": "value=$'\\200*\\377*'; pattern='*'; printf '%s\\000' \"${value#\"$pattern\"}\" \"${value%\"$pattern\"}\" \"${value##$pattern}\" \"${value%%$pattern}\"\n",
    "status": 0,
    "stdoutHex": "802aff2a00802aff000000",
    "stderrHex": ""
  },
  {
    "name": "trim-nested-operand",
    "locale": "C",
    "script": "value=$'\\200ab\\377.'; pattern=x.; result=${value%${pattern#x}}; printf '%s' \"$result\"\n",
    "status": 0,
    "stdoutHex": "806162ff",
    "stderrHex": ""
  },
  {
    "name": "trim-concatenated-quoted",
    "locale": "C",
    "script": "value=$'\\200.'; other=$'\\377.'; printf '%s\\000' pre\"${value%.}\"post \"${value%.}\"${other%.}\n",
    "status": 0,
    "stdoutHex": "70726580706f73740080ff00",
    "stderrHex": ""
  },
  {
    "name": "trim-unquoted-IFS",
    "locale": "C",
    "script": "value=$'\\200:\\377.'; IFS=:; set -- ${value%.}; printf '%s\\000' \"$@\"\n",
    "status": 0,
    "stdoutHex": "8000ff00",
    "stderrHex": ""
  },
  {
    "name": "trim-empty-and-no-match",
    "locale": "C",
    "script": "value=$'\\200\\377'; empty=; printf '%s\\000' \"${value%}\" \"${value#}\" \"${empty##*}\" \"${value%%*}\" \"${value#not}\"\n",
    "status": 0,
    "stdoutHex": "80ff0080ff00000080ff00",
    "stderrHex": ""
  },
  {
    "name": "trim-unicode-quoted-pattern",
    "locale": "C",
    "script": "value=$'\\303\\251\\360\\237\\231\\202\\303\\251'; pattern=$'\\303\\251'; printf '%s\\000' \"${value#\"$pattern\"}\" \"${value%\"$pattern\"}\"\n",
    "status": 0,
    "stdoutHex": "f09f9982c3a900c3a9f09f998200",
    "stderrHex": ""
  },
  {
    "name": "eval-argument-joining",
    "locale": "C",
    "script": "raw=$'\\200\\377'; eval -- 'set' '--' \"'$raw'\" \"''\" \"'é🙂'\"; printf '%s\\000' \"$@\"\n",
    "status": 0,
    "stdoutHex": "80ff0000c3a9f09f998200",
    "stderrHex": ""
  },
  {
    "name": "eval-double-quoted-raw",
    "locale": "C",
    "script": "raw=$'\\200\\377'; eval 'set -- \"'\"$raw\"'\"'; printf '%s' \"$1\"\n",
    "status": 0,
    "stdoutHex": "80ff",
    "stderrHex": ""
  },
  {
    "name": "eval-distinct-invalid-and-replacement",
    "locale": "C",
    "script": "first=$'\\200'; second=$'\\377'; third=$'\\357\\277\\275'; eval \"set -- '$first' '$second' '$third'\"; printf '%s\\000' \"$@\"\n",
    "status": 0,
    "stdoutHex": "8000ff00efbfbd00",
    "stderrHex": ""
  },
  {
    "name": "eval-quote-and-inert-metacharacters",
    "locale": "C",
    "script": "raw=$'\\200\\377'; eval \"set -- '$raw' \\\"a'quote\\\" '\\$(missing-command); *'\"; printf '%s\\000' \"$@\"\n",
    "status": 0,
    "stdoutHex": "80ff00612771756f74650024286d697373696e672d636f6d6d616e64293b202a00",
    "stderrHex": ""
  },
  {
    "name": "eval-empty-and-valid-Unicode",
    "locale": "C",
    "script": "eval; eval ''; eval -- \"set -- '' 'é🙂'\"; printf '%s\\000' \"$@\"\n",
    "status": 0,
    "stdoutHex": "00c3a9f09f998200",
    "stderrHex": ""
  },
  {
    "name": "eval-after-command-substitution-trim",
    "locale": "C",
    "script": "raw=$(printf '%b' '\\0200\\0377\\0012.'); raw=${raw%.}; eval \"set -- '$raw'\"; printf '%s' \"$1\"\n",
    "status": 0,
    "stdoutHex": "80ff0a",
    "stderrHex": ""
  },
  {
    "name": "trim-quoted-patterns",
    "locale": "C.UTF-8",
    "script": "value=$'\\200*\\377*'; pattern='*'; printf '%s\\000' \"${value#\"$pattern\"}\" \"${value%\"$pattern\"}\" \"${value##$pattern}\" \"${value%%$pattern}\"\n",
    "status": 0,
    "stdoutHex": "802aff2a00802aff000000",
    "stderrHex": ""
  },
  {
    "name": "trim-nested-operand",
    "locale": "C.UTF-8",
    "script": "value=$'\\200ab\\377.'; pattern=x.; result=${value%${pattern#x}}; printf '%s' \"$result\"\n",
    "status": 0,
    "stdoutHex": "806162ff",
    "stderrHex": ""
  },
  {
    "name": "trim-concatenated-quoted",
    "locale": "C.UTF-8",
    "script": "value=$'\\200.'; other=$'\\377.'; printf '%s\\000' pre\"${value%.}\"post \"${value%.}\"${other%.}\n",
    "status": 0,
    "stdoutHex": "70726580706f73740080ff00",
    "stderrHex": ""
  },
  {
    "name": "trim-unquoted-IFS",
    "locale": "C.UTF-8",
    "script": "value=$'\\200:\\377.'; IFS=:; set -- ${value%.}; printf '%s\\000' \"$@\"\n",
    "status": 0,
    "stdoutHex": "8000ff00",
    "stderrHex": ""
  },
  {
    "name": "trim-empty-and-no-match",
    "locale": "C.UTF-8",
    "script": "value=$'\\200\\377'; empty=; printf '%s\\000' \"${value%}\" \"${value#}\" \"${empty##*}\" \"${value%%*}\" \"${value#not}\"\n",
    "status": 0,
    "stdoutHex": "80ff0080ff00000080ff00",
    "stderrHex": ""
  },
  {
    "name": "trim-unicode-quoted-pattern",
    "locale": "C.UTF-8",
    "script": "value=$'\\303\\251\\360\\237\\231\\202\\303\\251'; pattern=$'\\303\\251'; printf '%s\\000' \"${value#\"$pattern\"}\" \"${value%\"$pattern\"}\"\n",
    "status": 0,
    "stdoutHex": "f09f9982c3a900c3a9f09f998200",
    "stderrHex": ""
  },
  {
    "name": "eval-argument-joining",
    "locale": "C.UTF-8",
    "script": "raw=$'\\200\\377'; eval -- 'set' '--' \"'$raw'\" \"''\" \"'é🙂'\"; printf '%s\\000' \"$@\"\n",
    "status": 0,
    "stdoutHex": "80ff0000c3a9f09f998200",
    "stderrHex": ""
  },
  {
    "name": "eval-double-quoted-raw",
    "locale": "C.UTF-8",
    "script": "raw=$'\\200\\377'; eval 'set -- \"'\"$raw\"'\"'; printf '%s' \"$1\"\n",
    "status": 0,
    "stdoutHex": "80ff",
    "stderrHex": ""
  },
  {
    "name": "eval-distinct-invalid-and-replacement",
    "locale": "C.UTF-8",
    "script": "first=$'\\200'; second=$'\\377'; third=$'\\357\\277\\275'; eval \"set -- '$first' '$second' '$third'\"; printf '%s\\000' \"$@\"\n",
    "status": 0,
    "stdoutHex": "8000ff00efbfbd00",
    "stderrHex": ""
  },
  {
    "name": "eval-quote-and-inert-metacharacters",
    "locale": "C.UTF-8",
    "script": "raw=$'\\200\\377'; eval \"set -- '$raw' \\\"a'quote\\\" '\\$(missing-command); *'\"; printf '%s\\000' \"$@\"\n",
    "status": 0,
    "stdoutHex": "80ff00612771756f74650024286d697373696e672d636f6d6d616e64293b202a00",
    "stderrHex": ""
  },
  {
    "name": "eval-empty-and-valid-Unicode",
    "locale": "C.UTF-8",
    "script": "eval; eval ''; eval -- \"set -- '' 'é🙂'\"; printf '%s\\000' \"$@\"\n",
    "status": 0,
    "stdoutHex": "00c3a9f09f998200",
    "stderrHex": ""
  },
  {
    "name": "eval-after-command-substitution-trim",
    "locale": "C.UTF-8",
    "script": "raw=$(printf '%b' '\\0200\\0377\\0012.'); raw=${raw%.}; eval \"set -- '$raw'\"; printf '%s' \"$1\"\n",
    "status": 0,
    "stdoutHex": "80ff0a",
    "stderrHex": ""
  }
] as const;
