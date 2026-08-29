# STR-03: replacement-string capture and context substitution

## Scope and ownership

- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-fixes`, base `9ef2e738d`.
- Own only `packages/safejs/src/interp/methods/string.ts`, new `packages/safejs/src/interp/methods/string-replacement.test.ts`, and this document.
- No edits to regex helpers, interpreter/iteration, number globals, lexer/parser, README, master plan, or other workers' files. No git mutations or publication.
- STR-02, STR-04, STR-05 and original workflow failures unrelated to replacement strings remain outside this fix.

## Evidence and contract

Read ancestor/root AGENTS; no nested AGENTS apply. Before family payload reads, load `inventory-verification.json` metadata from the read-only original audit, assert its exact 38 `archiveReadPolicy.excludedPaths`, and reject those paths plus the entire security directory. No excluded payload bytes, security material, or security probes were read or executed.

Review `strings/REPORT.md` STR-03, `strings/reductions/r03-replacement-captures.safejs`, `strings/reductions/r04-replacement-context.safejs`, and `strings/examples/06-template-replacement-unicode.safejs`. The current package README's plain-value ECMAScript method contract includes replace/replaceAll. ECMAScript 2024 section 22.1.3.19.1 GetSubstitution supplies the capture/context rules.

The pre-fix source conflated unset and nonexistent captures, consumed invalid two-digit references without fallback, excluded zero-padded captures, and lacked the input/offset needed by context tokens. Literal string searches already delegated to native substitution and needed only regression controls.

## Implementation sequence

1. Run independent bounded native oracles before SafeJS source, retaining complete original return values.
2. Add anchored focused tests for dollar/match/capture/context tokens, empty/unset captures, numeric boundaries, unknown literals, nonmatches, global/replaceAll and ordinary string controls, plus source-level template/redaction integration. Confirm RED before production edits.
3. Replace only the replacement-template expander with a single-pass scanner receiving original input and match offset. Leave regex collection, lastIndex, split, callbacks, and other methods unchanged.
4. Run focused and relevant broad suites, typecheck, inspect the exact scoped diff, and retain full original outputs and remaining differences for independent validation.

## Validation

Native originals run in fresh Node VM children (128 MiB, 1.5-second VM limit); SafeJS runs current `src/run.ts` via tsx in separate 192 MiB children with no host modules, 150000 steps, depth 48, 2.5-second deadline, 32768 string length, 4096 array length, and 2 MiB data. Both children have a 10-second host timeout. Tests use pure in-memory fixtures, no LLMs or filesystem writes. No visual CLI change; screenshots are not applicable.

- RED: direct Vitest exit 1, 45 failed / 53 passed (98 total), 1.14 seconds; all failures were semantic assertions after correcting a fixture quote before the production patch.
- GREEN: same focused file, exit 0, 98 passed, 1.12 seconds (77 ms test execution).
- Relevant broad suite: 5 files, 175 tests passed, exit 0, 1.76 seconds (136 ms test execution).
- Package production typecheck and standalone focused-test typecheck: both exit 0, no diagnostics.
- ESLint on both owned TypeScript files, Prettier on the new test, and scoped `git diff --check`: pass. Formatting outside the production changes is left unchanged.

Commands:

```sh
node_modules/.bin/vitest run packages/safejs/src/interp/methods/string-replacement.test.ts --reporter=dot
node_modules/.bin/vitest run packages/safejs/src/interp/methods/string-replacement.test.ts packages/safejs/src/interp/methods/string.test.ts packages/safejs/src/interp/methods/regex.test.ts packages/safejs/src/interp/regex/engine.test.ts packages/safejs/src/interp/regex/parse.test.ts --reporter=dot
node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/safejs/src/interp/methods/string-replacement.test.ts
node_modules/.bin/eslint packages/safejs/src/interp/methods/string.ts packages/safejs/src/interp/methods/string-replacement.test.ts
node_modules/.bin/prettier --check packages/safejs/src/interp/methods/string-replacement.test.ts
git diff --check -- packages/safejs/src/interp/methods/string.ts
```

## Independent validator handoff

- Both original reductions now have exact native return-value parity, including unchanged nonexistent-capture and literal-search controls.
- Original workflow 06 now has native parity for every replacement-related field and the existing rendering, callback captures, Unicode, split, literal-search, and raw-template fields. Its only remaining differences are five token metadata offsets: `/0/tokens/0/offset` (2), `/0/tokens/1/offset` (13), `/1/tokens/0/offset` (0), `/1/tokens/1/offset` (9), `/1/tokens/2/offset` (18). SafeJS returns undefined for those properties; JSON omits them. This is the separately identified STR-01, not a STR-03 failure. Do not certify full original-workflow parity until it is independently resolved.
- The added substantial source test retains the original expression, Unicode fixtures, callback arguments, annotation and context replacements, and literal-search control; it adds redaction and callback-literal controls. It intentionally omits unrelated match metadata, split, code-point enumeration, and raw-template fields; the original unmodified workflow is separately rerun in full below.
- No STR-02/STR-04/STR-05 changes, named-group support, regex execution/state changes, or budget redesign. Tests use fresh regexes rather than asserting lastIndex behavior. Existing final-string allocation is unchanged.
- Validation observes a shared working tree with disjoint concurrent worker edits. Re-run these checks after serialized integration; no claim of isolated full-tree or full-package certification is made. No security/adversarial suite was run.
- Publication remains coordinator-owned; no commit, branch, push, dependency install, or original-repository write occurred.

## Complete original return-value evidence

The records below contain complete native and SafeJS return values, process status/signal/stderr, SafeJS success/error and execution statistics, and source SHA-256. Native results were independently recomputed before SafeJS for both baseline and final runs and matched each other. Runtime replay snapshots/random seeds are deliberately omitted from these result records; no returned payload field is truncated. Baseline SafeJS JSON already omits undefined token offsets.

### strings/reductions/r03-replacement-captures.safejs

```json
{
  "file": "strings/reductions/r03-replacement-captures.safejs",
  "sourceSha256": "28339e68c01d96468e9f825b0f7e5ef700fea39916b2aed206f728cfdb26365c",
  "native": {
    "exitStatus": 0,
    "signal": null,
    "stderr": "",
    "returnValue": {
      "missingOptional": "<>",
      "presentOptional": "<b>",
      "nonexistent": "<$2>",
      "fallbackTwoDigit": "<a0>",
      "zeroPaddedCapture": "<a>",
      "escapedDollar": "$:a:a"
    }
  },
  "safeBefore": {
    "exitStatus": 0,
    "signal": null,
    "stderr": "",
    "ok": true,
    "returnValue": {
      "missingOptional": "<$1>",
      "presentOptional": "<b>",
      "nonexistent": "<$2>",
      "fallbackTwoDigit": "<$10>",
      "zeroPaddedCapture": "<$01>",
      "escapedDollar": "$:a:a"
    },
    "error": null,
    "stats": {
      "nodeVisits": 32
    }
  },
  "safeAfter": {
    "exitStatus": 0,
    "signal": null,
    "stderr": "",
    "ok": true,
    "returnValue": {
      "missingOptional": "<>",
      "presentOptional": "<b>",
      "nonexistent": "<$2>",
      "fallbackTwoDigit": "<a0>",
      "zeroPaddedCapture": "<a>",
      "escapedDollar": "$:a:a"
    },
    "error": null,
    "stats": {
      "nodeVisits": 32
    }
  }
}
```

### strings/reductions/r04-replacement-context.safejs

```json
{
  "file": "strings/reductions/r04-replacement-context.safejs",
  "sourceSha256": "f5ebff2b937e8672a8042a0d367f4927c26779e394989d30fabece0f1e434ddc",
  "native": {
    "exitStatus": 0,
    "signal": null,
    "stderr": "",
    "returnValue": {
      "regexPrefix": "aac",
      "regexSuffix": "acc",
      "literalPrefix": "aac",
      "globalContext": "a[a|b2c]b[a1b|c]c"
    }
  },
  "safeBefore": {
    "exitStatus": 0,
    "signal": null,
    "stderr": "",
    "ok": true,
    "returnValue": {
      "regexPrefix": "a$`c",
      "regexSuffix": "a$'c",
      "literalPrefix": "aac",
      "globalContext": "a[$`|$']b[$`|$']c"
    },
    "error": null,
    "stats": {
      "nodeVisits": 22
    }
  },
  "safeAfter": {
    "exitStatus": 0,
    "signal": null,
    "stderr": "",
    "ok": true,
    "returnValue": {
      "regexPrefix": "aac",
      "regexSuffix": "acc",
      "literalPrefix": "aac",
      "globalContext": "a[a|b2c]b[a1b|c]c"
    },
    "error": null,
    "stats": {
      "nodeVisits": 22
    }
  }
}
```

### strings/examples/06-template-replacement-unicode.safejs

```json
{
  "file": "strings/examples/06-template-replacement-unicode.safejs",
  "sourceSha256": "d211632dfa16b9865d63699e8d1a4b47bd793f813447854173fd909b2fa2972b",
  "native": {
    "exitStatus": 0,
    "signal": null,
    "stderr": "",
    "returnValue": [
      {
        "tokens": [
          {
            "name": "name",
            "fallback": "",
            "offset": 2,
            "raw": "{{name}}"
          },
          {
            "name": "missing",
            "fallback": "é",
            "offset": 13,
            "raw": "{{missing|é}}"
          }
        ],
        "captures": [
          {
            "name": "name",
            "fallback": null,
            "offset": 2,
            "inputLength": 28
          },
          {
            "name": "missing",
            "fallback": "é",
            "offset": 13,
            "inputLength": 28
          }
        ],
        "rendered": "🧪名称 / é!",
        "annotated": "🧪[name:|$|{{name}}] / [missing:é|$|{{missing|é}}]!",
        "prefixViews": "🧪<🧪> / <🧪{{name}} / >!",
        "suffixViews": "🧪< / {{missing|é}}!> / <!>!",
        "codePoints": [
          129514,
          21517,
          31216,
          32,
          47,
          32,
          233,
          33
        ],
        "normalized": "🧪名称 / é!",
        "pieces": [
          "🧪",
          "{{name}}",
          " / ",
          "{{missing|é}}",
          "!"
        ],
        "literalReplacement": "🧪$& / {{missing|é}}!",
        "sourceTemplate": "prefix\\n名称\\tend"
      },
      {
        "tokens": [
          {
            "name": "name",
            "fallback": "",
            "offset": 0,
            "raw": "{{name}}"
          },
          {
            "name": "name",
            "fallback": "",
            "offset": 9,
            "raw": "{{name}}"
          },
          {
            "name": "count",
            "fallback": "zero",
            "offset": 18,
            "raw": "{{count|zero}}"
          }
        ],
        "captures": [
          {
            "name": "name",
            "fallback": null,
            "offset": 0,
            "inputLength": 32
          },
          {
            "name": "name",
            "fallback": null,
            "offset": 9,
            "inputLength": 32
          },
          {
            "name": "count",
            "fallback": "zero",
            "offset": 18,
            "inputLength": 32
          }
        ],
        "rendered": "café-café-0",
        "annotated": "[name:|$|{{name}}]-[name:|$|{{name}}]-[count:zero|$|{{count|zero}}]",
        "prefixViews": "<>-<{{name}}->-<{{name}}-{{name}}->",
        "suffixViews": "<-{{name}}-{{count|zero}}>-<-{{count|zero}}>-<>",
        "codePoints": [
          99,
          97,
          102,
          233,
          45,
          99,
          97,
          102,
          233,
          45,
          48
        ],
        "normalized": "café-café-0",
        "pieces": [
          "",
          "{{name}}",
          "-",
          "{{name}}",
          "-",
          "{{count|zero}}",
          ""
        ],
        "literalReplacement": "$&-$&-{{count|zero}}",
        "sourceTemplate": "prefix\\ncafé\\tend"
      },
      {
        "tokens": [],
        "captures": [],
        "rendered": "literal 🧪 é",
        "annotated": "literal 🧪 é",
        "prefixViews": "literal 🧪 é",
        "suffixViews": "literal 🧪 é",
        "codePoints": [
          108,
          105,
          116,
          101,
          114,
          97,
          108,
          32,
          129514,
          32,
          101,
          769
        ],
        "normalized": "literal 🧪 é",
        "pieces": [
          "literal 🧪 é"
        ],
        "literalReplacement": "literal 🧪 é",
        "sourceTemplate": "prefix\\nΩ\\tend"
      }
    ]
  },
  "safeBefore": {
    "exitStatus": 0,
    "signal": null,
    "stderr": "",
    "ok": true,
    "returnValue": [
      {
        "tokens": [
          {
            "name": "name",
            "fallback": "",
            "raw": "{{name}}"
          },
          {
            "name": "missing",
            "fallback": "é",
            "raw": "{{missing|é}}"
          }
        ],
        "captures": [
          {
            "name": "name",
            "fallback": null,
            "offset": 2,
            "inputLength": 28
          },
          {
            "name": "missing",
            "fallback": "é",
            "offset": 13,
            "inputLength": 28
          }
        ],
        "rendered": "🧪名称 / é!",
        "annotated": "🧪[name:$2|$|{{name}}] / [missing:é|$|{{missing|é}}]!",
        "prefixViews": "🧪<$`> / <$`>!",
        "suffixViews": "🧪<$'> / <$'>!",
        "codePoints": [
          129514,
          21517,
          31216,
          32,
          47,
          32,
          233,
          33
        ],
        "normalized": "🧪名称 / é!",
        "pieces": [
          "🧪",
          "{{name}}",
          " / ",
          "{{missing|é}}",
          "!"
        ],
        "literalReplacement": "🧪$& / {{missing|é}}!",
        "sourceTemplate": "prefix\\n名称\\tend"
      },
      {
        "tokens": [
          {
            "name": "name",
            "fallback": "",
            "raw": "{{name}}"
          },
          {
            "name": "name",
            "fallback": "",
            "raw": "{{name}}"
          },
          {
            "name": "count",
            "fallback": "zero",
            "raw": "{{count|zero}}"
          }
        ],
        "captures": [
          {
            "name": "name",
            "fallback": null,
            "offset": 0,
            "inputLength": 32
          },
          {
            "name": "name",
            "fallback": null,
            "offset": 9,
            "inputLength": 32
          },
          {
            "name": "count",
            "fallback": "zero",
            "offset": 18,
            "inputLength": 32
          }
        ],
        "rendered": "café-café-0",
        "annotated": "[name:$2|$|{{name}}]-[name:$2|$|{{name}}]-[count:zero|$|{{count|zero}}]",
        "prefixViews": "<$`>-<$`>-<$`>",
        "suffixViews": "<$'>-<$'>-<$'>",
        "codePoints": [
          99,
          97,
          102,
          233,
          45,
          99,
          97,
          102,
          233,
          45,
          48
        ],
        "normalized": "café-café-0",
        "pieces": [
          "",
          "{{name}}",
          "-",
          "{{name}}",
          "-",
          "{{count|zero}}",
          ""
        ],
        "literalReplacement": "$&-$&-{{count|zero}}",
        "sourceTemplate": "prefix\\ncafé\\tend"
      },
      {
        "tokens": [],
        "captures": [],
        "rendered": "literal 🧪 é",
        "annotated": "literal 🧪 é",
        "prefixViews": "literal 🧪 é",
        "suffixViews": "literal 🧪 é",
        "codePoints": [
          108,
          105,
          116,
          101,
          114,
          97,
          108,
          32,
          129514,
          32,
          101,
          769
        ],
        "normalized": "literal 🧪 é",
        "pieces": [
          "literal 🧪 é"
        ],
        "literalReplacement": "literal 🧪 é",
        "sourceTemplate": "prefix\\nΩ\\tend"
      }
    ],
    "error": null,
    "stats": {
      "nodeVisits": 619
    }
  },
  "safeAfter": {
    "exitStatus": 0,
    "signal": null,
    "stderr": "",
    "ok": true,
    "returnValue": [
      {
        "tokens": [
          {
            "name": "name",
            "fallback": "",
            "raw": "{{name}}"
          },
          {
            "name": "missing",
            "fallback": "é",
            "raw": "{{missing|é}}"
          }
        ],
        "captures": [
          {
            "name": "name",
            "fallback": null,
            "offset": 2,
            "inputLength": 28
          },
          {
            "name": "missing",
            "fallback": "é",
            "offset": 13,
            "inputLength": 28
          }
        ],
        "rendered": "🧪名称 / é!",
        "annotated": "🧪[name:|$|{{name}}] / [missing:é|$|{{missing|é}}]!",
        "prefixViews": "🧪<🧪> / <🧪{{name}} / >!",
        "suffixViews": "🧪< / {{missing|é}}!> / <!>!",
        "codePoints": [
          129514,
          21517,
          31216,
          32,
          47,
          32,
          233,
          33
        ],
        "normalized": "🧪名称 / é!",
        "pieces": [
          "🧪",
          "{{name}}",
          " / ",
          "{{missing|é}}",
          "!"
        ],
        "literalReplacement": "🧪$& / {{missing|é}}!",
        "sourceTemplate": "prefix\\n名称\\tend"
      },
      {
        "tokens": [
          {
            "name": "name",
            "fallback": "",
            "raw": "{{name}}"
          },
          {
            "name": "name",
            "fallback": "",
            "raw": "{{name}}"
          },
          {
            "name": "count",
            "fallback": "zero",
            "raw": "{{count|zero}}"
          }
        ],
        "captures": [
          {
            "name": "name",
            "fallback": null,
            "offset": 0,
            "inputLength": 32
          },
          {
            "name": "name",
            "fallback": null,
            "offset": 9,
            "inputLength": 32
          },
          {
            "name": "count",
            "fallback": "zero",
            "offset": 18,
            "inputLength": 32
          }
        ],
        "rendered": "café-café-0",
        "annotated": "[name:|$|{{name}}]-[name:|$|{{name}}]-[count:zero|$|{{count|zero}}]",
        "prefixViews": "<>-<{{name}}->-<{{name}}-{{name}}->",
        "suffixViews": "<-{{name}}-{{count|zero}}>-<-{{count|zero}}>-<>",
        "codePoints": [
          99,
          97,
          102,
          233,
          45,
          99,
          97,
          102,
          233,
          45,
          48
        ],
        "normalized": "café-café-0",
        "pieces": [
          "",
          "{{name}}",
          "-",
          "{{name}}",
          "-",
          "{{count|zero}}",
          ""
        ],
        "literalReplacement": "$&-$&-{{count|zero}}",
        "sourceTemplate": "prefix\\ncafé\\tend"
      },
      {
        "tokens": [],
        "captures": [],
        "rendered": "literal 🧪 é",
        "annotated": "literal 🧪 é",
        "prefixViews": "literal 🧪 é",
        "suffixViews": "literal 🧪 é",
        "codePoints": [
          108,
          105,
          116,
          101,
          114,
          97,
          108,
          32,
          129514,
          32,
          101,
          769
        ],
        "normalized": "literal 🧪 é",
        "pieces": [
          "literal 🧪 é"
        ],
        "literalReplacement": "literal 🧪 é",
        "sourceTemplate": "prefix\\nΩ\\tend"
      }
    ],
    "error": null,
    "stats": {
      "nodeVisits": 619
    }
  }
}
```
