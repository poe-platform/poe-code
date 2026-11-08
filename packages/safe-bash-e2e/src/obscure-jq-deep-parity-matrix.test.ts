import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure jq deep parity matrix (20 complex cases)", () => {
  it("1. jq --version, -V, --help, and -h CLI flags", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
jq --version
jq -V
jq --help | head -n 1
jq -h | head -n 1
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "jq-1.7.1",
        "jq-1.7.1",
        "jq - commandline JSON processor [version 1.7.1]",
        "jq - commandline JSON processor [version 1.7.1]",
        "",
      ].join("\n")
    );
  });

  it("2. input and inputs stream consumption across -n, -c, -s, -R, limit, and multiple files", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/workspace/a.json": "10\n20\n",
        "/workspace/b.json": "30\n",
      },
    });
    const r = await h.exec(String.raw`
printf 'a,b\nc,d\n' | jq -Rnc '[inputs | split(",")]'
printf '1 2 3' | jq -nsc '[inputs]'
printf '1 2 3' | jq -nc '[limit(1; inputs)], [inputs]'
printf '1 2 3' | jq -nc '[inputs]'
printf '1 2 3' | jq -c '[., inputs]'
printf 'a\n\nb' | jq -Rnc 'def rows: inputs; [rows]'
printf '' | jq -Rnc '[inputs]'
printf '5\n6\n7\n' | jq -nc '[first(inputs), first(inputs)]'
jq -nc '[inputs]' /workspace/a.json /workspace/b.json
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        '[["a","b"],["c","d"]]',
        "[[1,2,3]]",
        "[1]",
        "[2,3]",
        "[1,2,3]",
        "[1,2,3]",
        '["a","","b"]',
        "[]",
        "[5,6]",
        "[10,20,30]",
        "",
      ].join("\n")
    );
  });

  it("3. string interpolation with multi-value generators and @uri, @csv, @tsv, @sh, @html, @base64, @base64d", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '{"names":["a b","c/d"]}' | jq -c '[@uri "q=\(.names[])&x=1"]'
printf '{"a":[1,2],"b":["x","y"]}' | jq -c '["\(.a[])-\(.b[])"]'
printf '"!()*'\''"' | jq -c '@uri'
printf '"a b/é"' | jq -c '@uri'
printf '"é"' | jq -c '@base64 | @base64d'
printf '["a\\nb","c\\\\d","e\\rf"]' | jq -c '@tsv'
printf '["a,b",2,null,true]' | jq -c '@csv'
printf '["a b","x'\''y"]' | jq -c '@sh'
printf '"<&>"' | jq -c '@html'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        '["q=a%20b&x=1","q=c%2Fd&x=1"]',
        '["1-x","2-x","1-y","2-y"]',
        '"%21%28%29%2A%27"',
        '"a%20b%2F%C3%A9"',
        '"é"',
        '"a\\\\nb\\tc\\\\\\\\d\\te\\\\rf"',
        '"\\"a,b\\",2,,true"',
        "\"'a b' 'x'\\\\''y'\"",
        '"&lt;&amp;&gt;"',
        "",
      ].join("\n")
    );
  });

  it("4. fractional slice bounds (floor start, ceil end) on arrays and Unicode strings plus slice updates", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '"A😀BC"' | jq -c '.[1.5:2.1]'
printf '[10,20,30,40]' | jq -c '.[0.5:2.2]'
printf '"abcd"' | jq -c '.[0.5:2.2]'
printf '[0,1,2,3]' | jq -c '.[0.5:2.2] = [9]'
printf '[0,1,2,3]' | jq -c '.[1:3] = [9,9,9]'
printf '[0,1,2,3]' | jq -c '.[1:3] |= reverse'
printf '[0,1,2,3]' | jq -c '.[-2:] += [9]'
printf '[0,1,2,3]' | jq -c '.[1:3][] |= .+10'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        '"😀B"',
        "[10,20,30]",
        '"abc"',
        "[9,3]",
        "[0,9,9,9,3]",
        "[0,2,1,3]",
        "[0,1,2,3,9]",
        "[0,11,12,3]",
        "",
      ].join("\n")
    );
  });

  it("5. complex del(...) on slices, duplicate indices, chained slice index, and delpaths(...)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '[0,1,2,3]' | jq -c 'del(.[1:3])'
printf '[0,1,2,3]' | jq -c 'del(.[1,2,1])'
printf '[0,1,2,3]' | jq -c 'del(.[1:3][0])'
printf '{"a":{"x":1},"b":2}' | jq -c 'del(.a.x,.b)'
printf '{"a":1,"nested":{"a":2,"keep":3}}' | jq -c 'del(.. | .a?)'
printf '{"a":{"b":1,"c":2},"arr":[10,20,30]}' | jq -c 'delpaths([["a","b"],["arr",1]])'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "[0,3]",
        "[0,3]",
        "[0,2,3]",
        '{"a":{}}',
        '{"nested":{"keep":3}}',
        '{"a":{"c":2},"arr":[10,30]}',
        "",
      ].join("\n")
    );
  });

  it("6. optional and recursive path updates (.a? |=, (.[] | .a?) |=, (.. | numbers) |=)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '{"a":1}' | jq -c '.a? |= . + 1'
printf '[1,{"a":2}]' | jq -c '(.[] | .a?) |= . + 1'
printf '[1,2,3]' | jq -c '(.[] | select(. > 1)) |= . * 10'
printf '[1,{"a":2,"b":"skip","c":[3,false]}]' | jq -c '(.. | numbers) |= . + 10'
printf '{"a":{"b":1}}' | jq -c '(.a | .b) = 2'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        '{"a":2}',
        '[1,{"a":3}]',
        "[1,20,30]",
        '[11,{"a":12,"b":"skip","c":[13,false]}]',
        '{"a":{"b":2}}',
        "",
      ].join("\n")
    );
  });

  it("7. path(...), paths(...), leaf_paths, getpath, setpath, and pick(...)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
jq -nc 'path(.)'
jq -nc 'path(.a.b[0])'
printf '{"a":{"b":[10,20]}}' | jq -c '[path(.. | select(type == "number"))]'
printf '{"a":false,"b":null,"c":0,"d":"","e":[],"f":{},"g":true}' | jq -c '[leaf_paths]'
printf '{"a":1,"b":{"c":2,"d":3},"e":[4,5,6]}' | jq -c 'pick(.a, .b.c, .e[1])'
printf '{}' | jq -c 'pick(.missing)'
printf '{"a":{"b":[10,20]}}' | jq -c '[getpath(["a","b",1]), setpath(["a","b",1]; 99)]'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "[]",
        '["a","b",0]',
        '[["a","b",0],["a","b",1]]',
        '[["c"],["d"],["g"]]',
        '{"a":1,"b":{"c":2},"e":[null,5]}',
        '{"missing":null}',
        '[20,{"a":{"b":[10,99]}}]',
        "",
      ].join("\n")
    );
  });

  it("8. regex test, scan, splits, and 2-arg split with case-insensitive and empty-match flags", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '"FOObar"' | jq -c '[test("foo"), test("foo"; "i")]'
printf '"A"' | jq -c '[test("x"), test(["a","i"])]'
printf '"Aa"' | jq -c '[[scan("a")], [scan("a"; "i")], [scan("(a)"; "i")], [scan(""; "n")]]'
printf '"a, B, c"' | jq -c '[splits(",\\s*"; "i")]'
printf '"aAa"' | jq -c '[splits("A"; "i")]'
printf '"abbc"' | jq -c '[split("B+"; "i"), [splits("B+"; "i")]]'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "[false,true]",
        "[false,true]",
        '[["a"],["A","a"],[["A"],["a"]],[]]',
        '["a","B","c"]',
        '["","","",""]',
        '[["a","c"],["a","c"]]',
        "",
      ].join("\n")
    );
  });

  it("9. regex match and capture with named groups, optional unmatched groups, Unicode offsets, and global flag", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '"foo bar"' | jq -c 'match("(\\w+)")'
printf '"😀aa a"' | jq -c '[match("(?<x>a)(a)?"; "g")]'
printf '"b ab"' | jq -c '[match("(?<x>a)?b"; "g")]'
printf '"abc-123"' | jq -c 'capture("(?<a>[a-z]+)-(?<n>[0-9]+)")'
printf '"ABC-123"' | jq -c 'capture("(?<a>[a-z]+)-(?<n>[0-9]+)"; "i")'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        '{"offset":0,"length":3,"string":"foo","captures":[{"offset":0,"length":3,"string":"foo","name":null}]}',
        '[{"offset":1,"length":2,"string":"aa","captures":[{"offset":1,"length":1,"string":"a","name":"x"},{"offset":2,"length":1,"string":"a","name":null}]},{"offset":4,"length":1,"string":"a","captures":[{"offset":4,"length":1,"string":"a","name":"x"},{"offset":-1,"length":0,"string":null,"name":null}]}]',
        '[{"offset":0,"length":1,"string":"b","captures":[{"offset":-1,"length":0,"string":null,"name":"x"}]},{"offset":2,"length":2,"string":"ab","captures":[{"offset":2,"length":1,"string":"a","name":"x"}]}]',
        '{"a":"abc","n":"123"}',
        '{"a":"ABC","n":"123"}',
        "",
      ].join("\n")
    );
  });

  it("10. sub and gsub with flags, named group interpolation, and multi-value replacement streams", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '"foo bar foo"' | jq -c '[sub("foo"; "baz"), sub("foo"; "baz"; "g")]'
printf '"FOO bar foo"' | jq -c 'sub("foo"; "baz"; "i")'
printf '"id=42"' | jq -c 'sub("(?<a>[0-9]+)"; "num:\(.a)")'
printf '"1 2"' | jq -c 'gsub("(?<a>[0-9]+)"; "num:\(.a)")'
printf '"Aa"' | jq -c '[gsub("a"; ("x", "y"); "i")]'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        '["baz bar foo","baz bar baz"]',
        '"baz bar foo"',
        '"id=num:42"',
        '"num:1 num:2"',
        '["xx","yy"]',
        "",
      ].join("\n")
    );
  });

  it("11. user-defined functions with filter args, path-mutating filter args, and value ($x) generator args", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '[1,2]' | jq -c 'def sum(f): reduce .[] as $x (0; .+($x|f)); sum(.*2)'
jq -nc 'def f(x;y): [x,y]; f((1,2);3)'
printf '{"a":1}' | jq -c 'def f(x): x |= .+1; f(.a)'
printf '{"a":1}' | jq -c 'def f(x): del(x); f(.a)'
jq -nc '[def f($x): $x+$x; f((1,2))]'
jq -nc 'def f(x): x; def g(y): f(y); g(42)'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "6",
        "[1,2,3]",
        '{"a":2}',
        "{}",
        "[2,4]",
        "42",
        "",
      ].join("\n")
    );
  });

  it("12. recursive functions, nested defs, lexical variable capture, and parenthesized scoped defs", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
jq -nc 'def fact: if . <= 1 then 1 else . * ((. - 1) | fact) end; 5 | fact'
jq -nc 'def f($n): if $n == 0 then 1 else $n * f($n - 1) end; f(5)'
jq -nc 'def countdown(n): if n <= 0 then 0 else n, countdown(n - 1) end; [countdown(3)]'
jq -nc 'def countdown($n): if $n <= 0 then 0 else $n, countdown($n - 1) end; [countdown(3)]'
printf '1' | jq -c '(def f: . + 10; f) + (def f: . + 20; f)'
jq -nc '[def f: 1; (def f: 2; f), f]'
jq -nc '1 as $x | def f: $x; 2 as $x | f'
jq -nc 'def outer($x): def inner: $x; 9 as $x | inner; outer(3)'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "120",
        "120",
        "[3,2,1,0]",
        "[3,2,1,0]",
        "32",
        "[2,1]",
        "1",
        "3",
        "",
      ].join("\n")
    );
  });

  it("13. trim, ltrim, rtrim with Unicode whitespace, ascii_downcase/upcase, explode/implode, utf8bytelength", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '"  hello world  "' | jq -c '[trim, ltrim, rtrim]'
printf '"\u00a0\u2003😀 a\u2028"' | jq -c '[trim, ltrim, rtrim]'
printf '"HELLOéİ"' | jq -c 'ascii_downcase'
printf '"helloéß"' | jq -c 'ascii_upcase'
printf '"hello"' | jq -c '[startswith("he"),endswith("lo"),ltrimstr("he"),rtrimstr("lo")]'
printf '"a😀b"' | jq -c '[utf8bytelength, explode, (explode | implode)]'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        '["hello world","hello world  ","  hello world"]',
        '["😀 a","😀 a\u2028","\u00a0\u2003😀 a"]',
        '"helloéİ"',
        '"HELLOéß"',
        '[true,true,"llo","hel"]',
        '[6,[97,128512,98],"a😀b"]',
        "",
      ].join("\n")
    );
  });

  it("14. flatten on objects and fractional depths, combinations(n), and transpose", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '{"a":[1,[2]]}' | jq -c 'flatten'
printf '[1,[2,[3]]]' | jq -c '[flatten, flatten(1), flatten(0), flatten(0.5)]'
printf '[[0,1],[2,3]]' | jq -c '[combinations]'
printf '[0,1]' | jq -c '[combinations(2)]'
printf '[1,2]' | jq -c '[[combinations(0)], [combinations(-1)], [combinations(0,1)]]'
printf '[[1,2,3],[4,5]]' | jq -c 'transpose'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "[1,2]",
        "[[1,2,3],[1,2,[3]],[1,[2,[3]]],[1,2,3]]",
        "[[0,2],[0,3],[1,2],[1,3]]",
        "[[0,0],[0,1],[1,0],[1,1]]",
        "[[[]],[[]],[[1],[2]]]",
        "[[1,4],[2,5],[3,null]]",
        "",
      ].join("\n")
    );
  });

  it("15. stream & index builtins: in, IN, INDEX, isempty, nth (including short-circuiting and fractional n)", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '"a"' | jq -c 'in({"a":1})'
printf '1' | jq -c 'in([10,20])'
printf '3' | jq -c '[IN(1,2,3), IN(4,5,6)]'
printf '[1,2]' | jq -c '[IN(.[]; 2,4), IN(.[]; .)]'
jq -nc 'IN(empty; empty)'
printf '[{"id":"x","v":1},{"id":"y","v":2}]' | jq -c '[INDEX(.[]; .id), INDEX(.id)]'
printf '[1,2,1]' | jq -c 'INDEX(tostring)'
printf '[{"a":"x","b":"y"}]' | jq -c 'INDEX((.a,.b))'
jq -nc '[isempty(empty), isempty(1, error("unreachable")), nth(0; 1, error("unreachable")), nth(1.5; range(4))]'
printf '[1]' | jq -c '[nth(9), [nth(9; .[])]]'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "true",
        "true",
        "[true,false]",
        "[true,false]",
        "false",
        '[{"x":{"id":"x","v":1},"y":{"id":"y","v":2}},{"x":{"id":"x","v":1},"y":{"id":"y","v":2}}]',
        '{"1":1,"2":2}',
        '{"x":{"a":"x","b":"y"},"y":{"a":"x","b":"y"}}',
        "[true,false,1,2]",
        "[null,[]]",
        "",
      ].join("\n")
    );
  });

  it("16. date/time builtins: todate, fromdate, gmtime, mktime, strftime, strptime", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '0' | jq -c '[todate, ("1970-01-01T00:00:00Z" | fromdate), gmtime, (gmtime | mktime), strftime("%Y-%m-%d %H:%M:%S")]'
printf '"2024-02-29"' | jq -c '[strptime("%Y-%m-%d"), (strptime("%Y-%m-%d") | mktime | gmtime | strftime("%F %j %a"))]'
printf '"2024-01-01T00:30:00+0230"' | jq -c 'strptime("%FT%T%z")'
printf '"2024 09 4"' | jq -c 'strptime("%Y %W %w")'
printf '"123"' | jq -c 'strptime("%s")'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        '["1970-01-01T00:00:00Z",0,[1970,0,1,0,0,0,4,0],0,"1970-01-01 00:00:00"]',
        '[[2024,1,29,0,0,0,4,59],"2024-02-29 060 Thu"]',
        "[2023,11,31,22,0,0,0,364]",
        "[2024,1,29,0,0,0,4,59]",
        "[1970,0,1,0,2,3,4,0]",
        "",
      ].join("\n")
    );
  });

  it("17. try/catch with structured error values, bare error, optional ?, and if/elif without else", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
jq -nc '[try error({a:1}) catch ., try error(false) catch ., try error(null) catch ., try error("boom") catch .]'
printf '"boom"' | jq -c 'try error catch .'
printf '[5,-5,0]' | jq -c 'map(if . > 0 then . * 2 end)'
printf '[5,-5,0]' | jq -c 'map(if . > 0 then 1 elif . < 0 then -1 end)'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        '[{"a":1},false,null,"boom"]',
        '"boom"',
        "[10,-5,0]",
        "[1,-1,0]",
        "",
      ].join("\n")
    );
  });

  it("18. destructuring bindings, alternative destructuring ?//, and label/break in foreach", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf '[{"a":1,"b":2},[10,20]]' | jq -c '[.[] as {$a, b: $b} ?// [$a, $b] | [$a, $b]]'
printf '[1,2,3,4,5]' | jq -c '[label $out | foreach .[] as $x (0; . + $x; if . > 5 then break $out else . end)]'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "[[1,2],[10,20]]",
        "[1,3]",
        "",
      ].join("\n")
    );
  });

  it("19. math builtins (abs, fabs, floor, ceil, round, sqrt, isnan, infinite, nan) and bsearch", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
printf -- '-3.7' | jq -c '[abs, fabs, floor, ceil, round, (9 | sqrt), (-1 | sqrt | isnan)]'
printf '[10,20,30,40]' | jq -c '[bsearch(20), bsearch(25), bsearch(5)]'
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "[3.7,3.7,-4,-3,-4,3,true]",
        "[1,-3,-1]",
        "",
      ].join("\n")
    );
  });

  it("20. runtime error exit code 5 on invalid flatten depth, invalid format inputs, and division by zero", async () => {
    const h = await SafeBashE2EHarness.create();
    const r = await h.exec(String.raw`
set +e
jq -nc '[] | flatten(-1)' >/dev/null 2>&1; echo "e1=$?"
jq -nc '[] | flatten("x")' >/dev/null 2>&1; echo "e2=$?"
jq -nc '1 | @csv' >/dev/null 2>&1; echo "e3=$?"
jq -nc '[{}] | @tsv' >/dev/null 2>&1; echo "e4=$?"
jq -nc '{} | @sh' >/dev/null 2>&1; echo "e5=$?"
jq -nc '"*" | @base64d' >/dev/null 2>&1; echo "e6=$?"
jq -nc '1 / 0' >/dev/null 2>&1; echo "e7=$?"
`);
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.stdout,
      [
        "e1=5",
        "e2=5",
        "e3=5",
        "e4=5",
        "e5=5",
        "e6=5",
        "e7=5",
        "",
      ].join("\n")
    );
  });
});
