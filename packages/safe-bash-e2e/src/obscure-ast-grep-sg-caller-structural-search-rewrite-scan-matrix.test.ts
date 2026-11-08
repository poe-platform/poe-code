import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure ast-grep, sg, and caller structural search, rewrite, scan, and stack-frame matrix", () => {
  test("1. ast-grep and sg --help / -h emit usage documentation and exit 0", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
ast-grep --help | grep -q "Usage: ast-grep"
sg -h | grep -q "Aliases: sg"
ast-grep --help | grep -q "Languages: ts, tsx, js, jsx, json, yaml, html, css"
echo "HELP_OK"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), "HELP_OK");
  });

  test("2. ast-grep searches directories structurally, skips unsupported extensions, and emits UTF-8 byte offsets and Unicode scalar columns", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/a.ts": "// é\nconsole.log(value);\n",
        "/workspace/b.txt": "console.log(no);\n",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
ast-grep -p 'console.log($A)' --json=compact
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].file, "a.ts");
    assert.equal(parsed[0].text, "console.log(value)");
    assert.deepEqual(parsed[0].range.byteOffset, { start: 6, end: 24 });
    assert.deepEqual(parsed[0].range.start, { line: 1, column: 0 });
    assert.deepEqual(parsed[0].range.end, { line: 1, column: 18 });
    assert.equal(parsed[0].metaVariables.single.A.text, "value");
  });

  test("3. sg enforces structural equality on repeated metavariables while allowing anonymous wildcards", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/sample.ts": 'f(a + b, a+b); f(a, b); // f(x,x)\n"f(x,x)";\n',
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
sg -p 'f($X, $X)' --json=compact sample.ts > eq.json
sg -p 'f($_, $_)' --json=compact sample.ts > wild.json
jq -r '.[].text' eq.json
jq -r 'length' wild.json
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), "f(a + b, a+b)\n2");
  });

  test("4. ast-grep run with variadic $$$ARGS previews rewrites without mutating files and updates in-place with -U while preserving trivia", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/a.ts": "  console.log(a, /*keep*/ b); // hi\n",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
ast-grep run -p 'console.log($$$ARGS)' -r 'logger.info($$$ARGS)' -l ts a.ts > preview.txt
grep -q 'logger.info(a, /\*keep\*/ b)' preview.txt
grep -q 'console.log(a, /\*keep\*/ b)' a.ts
ast-grep run -p 'console.log($$$ARGS)' -r 'logger.info($$$ARGS)' -l ts -U a.ts
cat a.ts
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout, "a.ts:1:  console.log(a, /*keep*/ b); // hi\n  logger.info(a, /*keep*/ b); // hi\n  logger.info(a, /*keep*/ b); // hi\n");
  });

  test("5. ast-grep captures variadic sequences across arrays, objects, function blocks, JSX children, and fixed-suffix backtracking", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '[a, b, c]' | ast-grep --stdin -l tsx -p '[$X, $$$ARGS]' --json=compact | jq -r '.[0].metaVariables.single.X.text + "|" + ([.[0].metaVariables.multi.ARGS[].text] | join(","))'
printf '({a: 1, b: 2})' | ast-grep --stdin -l tsx -p '({$$$ARGS})' --json=compact | jq -r '[.[0].metaVariables.multi.ARGS[].text] | join(";")'
printf 'function f() { a(); b(); }' | ast-grep --stdin -l tsx -p 'function f() { $$$ARGS }' --json=compact | jq -r '[.[0].metaVariables.multi.ARGS[].text] | join("|")'
printf '<Box><A /> hello <B /></Box>' | ast-grep --stdin -l tsx -p '<Box>$$$ARGS</Box>' --json=compact | jq -r '.[0].text'
printf 'f(a, stop, b, stop); f(stop);' | ast-grep --stdin -l ts -p 'f($$$A, stop, $$$B)' --json=compact | jq -r 'length'
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "a|b,,,c",
      "a: 1;,;b: 2",
      "a();|b();",
      "<Box><A /> hello <B /></Box>",
      "2",
    ]);
  });

  test("6. ast-grep --stdin supports ts, tsx, js, jsx, json, yaml, html, and css across compact, pretty, and stream JSON modes", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf 'f(a)' | ast-grep --stdin -l ts -p 'f($X)' --json=compact | jq -r '.[0].metaVariables.single.X.text'
printf '<X a={b} />' | ast-grep --stdin -l tsx -p '<X a={$V} />' --json=compact | jq -r '.[0].metaVariables.single.V.text'
printf 'f(js_ok)' | ast-grep --stdin -l js -p 'f($X)' --json=compact | jq -r '.[0].metaVariables.single.X.text'
printf '<X />' | ast-grep --stdin -l jsx -p '<X />' --json=compact | jq -r '.[0].text'
printf '{"x":1,"y":2}' | ast-grep --stdin -l json -p '"x": $V' --json=compact | jq -r '.[0].metaVariables.single.V.text'
printf 'x: one\ny: two\n' | ast-grep --stdin -l yaml -p 'x: $V' --json=compact | jq -r '.[0].metaVariables.single.V.text'
printf '<div><b>Hello</b></div>' | ast-grep --stdin -l html -p '<b>$V</b>' --json=compact | jq -r '.[0].metaVariables.single.V.text'
printf '.x { color: red; }' | ast-grep --stdin -l css -p 'color: $V;' --json=compact | jq -r '.[0].metaVariables.single.V.text'
printf 'f(a);f(b);' | ast-grep --stdin -l ts -p 'f($X)' --json=stream | wc -l | tr -d ' '
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "a",
      "b",
      "js_ok",
      "<X />",
      "1",
      "one",
      "Hello",
      "red",
      "2",
    ]);
  });

  test("7. ast-grep filters with --globs include/exclude patterns and formats --heading and -A/-B/-C context lines with -- separators", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/a.ts": "// line1\nf(a);\n// line3\n// line4\n// line5\nf(b);\n// line7\n",
        "/workspace/skip.ts": "f(skip);\n",
        "/workspace/x.js": "f(js);\n",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
ast-grep -p 'f($X)' --globs '*.ts' --globs '!skip*' --heading=always -C 1
echo "==="
ast-grep -p 'f($X)' --globs '*.ts' --globs '!skip*' --heading=never -B 1 -A 0
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(
      r.stdout,
      [
        "a.ts",
        "1-// line1",
        "2:f(a);",
        "3-// line3",
        "--",
        "5-// line5",
        "6:f(b);",
        "7-// line7",
        "===",
        "a.ts-1-// line1",
        "a.ts:2:f(a);",
        "--",
        "a.ts-5-// line5",
        "a.ts:6:f(b);",
        "",
      ].join("\n")
    );
  });

  test("8. ast-grep scan loads YAML rules from -r rule.yml and --inline-rules multi-document streams and applies fixes with -U", async () => {
    const ruleYaml = [
      "id: no-console",
      "language: TypeScript",
      "rule:",
      "  pattern: console.log($X)",
      "fix: logger.info($X)",
      "message: Use logger",
      "severity: warning",
      "",
    ].join("\n");
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/rule.yml": ruleYaml,
        "/workspace/a.ts": "console.log(alpha);\n",
        "/workspace/b.ts": "console.log(beta);\n",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
ast-grep scan -r rule.yml --json=stream -U a.ts > scan_a.json
jq -r '[.ruleId, .message, .severity, .replacement] | join("|")' scan_a.json
cat a.ts
ast-grep scan --inline-rules "$(cat rule.yml)" --json=stream -U b.ts > scan_b.json
cat b.ts
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "no-console|Use logger|warning|logger.info(alpha)",
      "logger.info(alpha);",
      "logger.info(beta);",
    ]);
  });

  test("9. ast-grep scan evaluates composite relational rules (all, any, not, inside, has, follows, precedes, kind, regex) and rewrites with captured metavariables", async () => {
    const rules = [
      "id: relational-call",
      "language: TypeScript",
      "rule:",
      "  all:",
      "    - pattern: f($X)",
      "    - inside:",
      "        kind: FunctionDeclaration",
      "    - not:",
      "        has:",
      "          regex: '^skip$'",
      "    - follows:",
      "        pattern: before()",
      "    - precedes:",
      "        pattern: after()",
      "    - any:",
      "        - regex: '^f'",
      "        - kind: Number",
      "fix: g($X)",
      "",
    ].join("\n");
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/rules.yml": rules,
        "/workspace/code.ts": "function outer() { before(); f(target); f(skip); after(); } f(outside);\n",
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
ast-grep scan -r rules.yml -U code.ts
cat code.ts
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(
      r.stdout,
      "code.ts:1:function outer() { before(); f(target); f(skip); after(); } f(outside);\nfunction outer() { before(); g(target); f(skip); after(); } f(outside);\nfunction outer() { before(); g(target); f(skip); after(); } f(outside);\n"
    );
  });

  test("10. ast-grep rewrites outermost nested matches once and rejects overlapping multi-rule scan edits with exit code 2", async () => {
    const conflictRules = [
      "id: one",
      "language: TS",
      'rule: {pattern: "f($X)"}',
      "fix: g($X)",
      "---",
      "id: two",
      "language: TS",
      'rule: {pattern: "f($X)"}',
      "fix: h($X)",
      "",
    ].join("\n");
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/nested.ts": "// é\nf(f(a));\n",
        "/workspace/conflict.ts": "f(a);\n",
        "/workspace/conflict.yml": conflictRules,
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
ast-grep -p 'f($X)' -r 'g($X)' -U nested.ts
cat nested.ts
set +e
ast-grep scan -r conflict.yml --json -U conflict.ts > /dev/null 2> err.txt
rc=$?
set -e
echo "RC=$rc"
cat conflict.ts
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "nested.ts:2:f(f(a));",
      "// é",
      "g(f(a));",
      "// é",
      "g(f(a));",
      "RC=2",
      "f(a);",
    ]);
  });

  test("11. ast-grep preserves literal dollar strings in JSON and CSS and distinguishes sparse arrays and for-loop clauses", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
printf '["$X", 1]' | ast-grep --stdin -l json -p '"$X"' --json=compact | jq -r '.[].text'
printf 'a { content: "$X"; color: red; }' | ast-grep --stdin -l css -p 'content: "$X";' --json=compact | jq -r '.[].text'
printf '[a,,b]; [a,b];' | ast-grep --stdin -l ts -p '[a,b]' --json=compact | jq -r '.[].text'
printf 'for (; x;) {} for (x;;) {}' | ast-grep --stdin -l ts -p 'for (; $X;) {}' --json=compact | jq -r '.[].text'
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      '"$X"',
      'content: "$X"',
      "[a,b]",
      "for (; x;) {}",
    ]);
  });

  test("12. ast-grep returns exit status 1 on no matches and exit status 2 on invalid options or rule errors", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set +e
printf 'g(a)' | ast-grep --stdin -l ts -p 'f($X)'
rc_nomatch=$?
ast-grep 2>/dev/null
rc_empty=$?
ast-grep -p 2>/dev/null
rc_missing_val=$?
ast-grep --stdin -p 'x' 2>/dev/null
rc_stdin_nolang=$?
ast-grep scan --inline-rules 'rule: {bogus: true}' 2>/dev/null
rc_bad_rule=$?
ast-grep -p 'x' -C no 2>/dev/null
rc_bad_ctx=$?
ast-grep -p 'x' --wat 2>/dev/null
rc_unknown=$?
set -e
echo "$rc_nomatch,$rc_empty,$rc_missing_val,$rc_stdin_nolang,$rc_bad_rule,$rc_bad_ctx,$rc_unknown"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), "1,2,2,2,2,2,2");
  });

  test("13. caller builtin exits 1 at top-level and reports line and shell filename inside a top-level function call", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set +e
caller
rc_top=$?
set -e
probe() {
  caller
  caller --
  set +e
  caller 0
  rc_zero=$?
  set -e
  echo "RC_ZERO=$rc_zero"
}
probe
echo "RC_TOP=$rc_top"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "15 NULL",
      "15 NULL",
      "RC_ZERO=1",
      "RC_TOP=1",
    ]);
  });

  test("14. caller builtin walks multi-frame function call stacks (caller, caller 0, caller 1, caller 2)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
inner() {
  echo "default:$(caller)"
  echo "frame0:$(caller 0)"
  echo "frame1:$(caller 1)"
  set +e
  caller 2
  echo "frame2_rc:$?"
  set -e
}
middle() {
  inner
}
outer() {
  middle
}
outer
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "default:13 shell",
      "frame0:13 middle shell",
      "frame1:16 outer shell",
      "frame2_rc:1",
    ]);
  });

  test("15. caller builtin accepts -- option terminator and signed/padded decimal frame numbers", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set -euo pipefail
inner() {
  caller -- 0
  caller +0
  caller " 0 "
  caller 00
  caller 0 ignored_arg
  caller -- -0
  set +e
  caller 08
  rc_oct=$?
  caller -- -1
  rc_neg=$?
  caller 9223372036854775807
  rc_max=$?
  set -e
  echo "RCS=$rc_oct,$rc_neg,$rc_max"
}
outer() {
  inner
}
outer
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "21 outer shell",
      "21 outer shell",
      "21 outer shell",
      "21 outer shell",
      "21 outer shell",
      "21 outer shell",
      "RCS=1,1,1",
    ]);
  });

  test("16. caller builtin distinguishes invalid options, hex, octal, and non-numeric operands with exit code 2", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
inner() {
  for arg in "-1" "abc" "1.0" "" "0x0" "00x0" "0X0" "9223372036854775808"; do
    set +e
    out=$(caller "$arg" 2>&1)
    rc=$?
    set -e
    first_line=$(printf '%s\n' "$out" | head -n 1)
    second_line=$(printf '%s\n' "$out" | tail -n 1)
    echo "$rc|$first_line|$second_line"
  done
}
outer() { inner; }
outer
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "2|caller: -1: invalid option|caller: usage: caller [expr]",
      "2|caller: abc: invalid number|caller: usage: caller [expr]",
      "2|caller: 1.0: invalid number|caller: usage: caller [expr]",
      "2|caller: : invalid number|caller: usage: caller [expr]",
      "2|caller: 0x0: invalid hex number|caller: usage: caller [expr]",
      "2|caller: 00x0: invalid octal number|caller: usage: caller [expr]",
      "2|caller: 0X0: invalid number|caller: usage: caller [expr]",
      "2|caller: 9223372036854775808: invalid number|caller: usage: caller [expr]",
    ]);
  });

  test("17. caller builtin tracks sourced scripts and preserves frames across subshells", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/lib.sh": [
          "lib_fn() {",
          '  echo "in_fn:$(caller 0)"',
          '  ( echo "in_sub:$(caller 0)" )',
          "}",
          'echo "in_source:$(caller)"',
          "lib_fn",
          "",
        ].join("\n"),
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
source ./lib.sh
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "in_source:3 NULL",
      "in_fn:6 source ./lib.sh",
      "in_sub:6 source ./lib.sh",
    ]);
  });

  test("18. caller builtin in an executed child script sets top-level routine to main", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/run.sh": {
          content: [
            "#!/bin/bash",
            "work() {",
            '  echo "default:$(caller)"',
            '  echo "frame0:$(caller 0)"',
            "}",
            "work",
            "",
          ].join("\n"),
          mode: 0o755,
        },
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
./run.sh
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "default:6 ./run.sh",
      "frame0:6 main ./run.sh",
    ]);
  });

  test("19. which, type, and command -v discover ast-grep, sg, and caller and pipe ast-grep JSON stream into jq and sqlite3", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/src/service.ts": [
          "export function handler(req: Request) {",
          "  console.log(req.url);",
          "  console.warn(req.method);",
          "}",
          "",
        ].join("\n"),
        "/workspace/rules.yml": [
          "id: no-console-log",
          "language: ts",
          "rule:",
          "  pattern: console.log($MSG)",
          "severity: error",
          "message: Avoid console.log",
          "---",
          "id: no-console-warn",
          "language: ts",
          "rule:",
          "  pattern: console.warn($MSG)",
          "severity: warning",
          "message: Avoid console.warn",
          "",
        ].join("\n"),
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
command -v ast-grep >/dev/null
command -v sg >/dev/null
type caller | grep -q "caller"
sqlite3 audit.db "CREATE TABLE findings (rule_id TEXT, severity TEXT, line INT, arg TEXT);"
ast-grep scan -r rules.yml --json=stream src/service.ts | while IFS= read -r row; do
  rid=$(printf '%s' "$row" | jq -r '.ruleId')
  sev=$(printf '%s' "$row" | jq -r '.severity')
  ln=$(printf '%s' "$row" | jq -r '.range.start.line + 1')
  arg=$(printf '%s' "$row" | jq -r '.metaVariables.single.MSG.text')
  sqlite3 audit.db "INSERT INTO findings VALUES ('$rid', '$sev', $ln, '$arg');"
done
sqlite3 audit.db "SELECT rule_id, severity, line, arg FROM findings ORDER BY line;"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "no-console-log|error|2|req.url",
      "no-console-warn|warning|3|req.method",
    ]);
  });

  test("20. end-to-end polyglot code migration and call-stack audit workflow with sg, ast-grep, and caller", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/app.tsx": [
          "export function View() {",
          "  console.log(user.id, user.name);",
          "  return <LegacyCard title={user.name} />;",
          "}",
          "",
        ].join("\n"),
        "/workspace/migrate.yml": [
          "id: upgrade-log",
          "language: tsx",
          "rule:",
          "  pattern: console.log($$$ARGS)",
          "fix: telemetry.record($$$ARGS)",
          "---",
          "id: upgrade-card",
          "language: tsx",
          "rule:",
          "  pattern: <LegacyCard title={$TITLE} />",
          "fix: <ModernCard heading={$TITLE} />",
          "",
        ].join("\n"),
      },
    });
    const r = await h.exec(String.raw`
set -euo pipefail
audit_step() {
  local frame
  frame=$(caller 0)
  echo "AUDIT[$frame]: $1"
}
run_migration() {
  audit_step "starting sg scan"
  sg scan -r migrate.yml -U app.tsx
  audit_step "verifying migrated AST"
}
run_migration
cat app.tsx
set +e
sg -p 'console.log($$$ARGS)' app.tsx
rc_old=$?
set -e
sg -p '<ModernCard heading={$H} />' --json=compact app.tsx | jq -r '.[0].metaVariables.single.H.text'
echo "OLD_RC=$rc_old"
`);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "AUDIT[9 run_migration shell]: starting sg scan",
      "app.tsx:2:  console.log(user.id, user.name);",
      "app.tsx:3:  return <LegacyCard title={user.name} />;",
      "export function View() {",
      "  telemetry.record(user.id, user.name);",
      "  return <ModernCard heading={user.name} />;",
      "}",
      "AUDIT[11 run_migration shell]: verifying migrated AST",
      "export function View() {",
      "  telemetry.record(user.id, user.name);",
      "  return <ModernCard heading={user.name} />;",
      "}",
      "user.name",
      "OLD_RC=1",
    ]);
  });
});
