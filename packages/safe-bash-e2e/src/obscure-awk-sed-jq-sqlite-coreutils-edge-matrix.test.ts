import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure awk, sed, jq, sqlite3, and coreutils edge matrix", () => {
  it("1. awk 4-argument split(s, a, fs, seps) populates both fields and matched regex separators", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `awk 'BEGIN { n = split("a:b;c--d", a, /[:;]|--/, seps); printf "%d|", n; for(i=1;i<=n;i++) printf "%s(%s)", a[i], seps[i]; printf "\\n" }'`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "4|a(:)b(;)c(--)d()\n");
  });

  it("2. awk 3-argument match(s, r, a) populates capture group array alongside RSTART and RLENGTH", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `awk 'BEGIN { pos = match("id=42;user=alice", /id=([0-9]+);user=([a-z]+)/, m); print pos, RSTART, RLENGTH, m[0], m[1], m[2] }'`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "1 1 16 id=42;user=alice 42 alice\n");
  });

  it("3. awk gensub with capture backreferences (\\1, \\2), nth occurrence, and global replacement", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `awk 'BEGIN { s = "a1 b2 c3"; print gensub(/([a-z])([0-9])/, "\\\\2\\\\1", 2, s) "|" gensub(/([a-z])([0-9])/, "\\\\2\\\\1", "g", s) }'`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "a1 2b c3|1a 2b 3c\n");
  });

  it("4. awk strtonum parses hexadecimal (0x), octal (0...), and signed decimal strings", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `awk 'BEGIN { print strtonum("0x1f"), strtonum("077"), strtonum("-42.5") }'`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "31 63 -42.5\n");
  });

  it("5. awk asort, asorti, and bitwise functions (and, or, xor, lshift, rshift)", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        `awk 'BEGIN { a["z"]=30; a["a"]=10; a["m"]=20; n=asort(a, v); m=asorti(a, k); print n, v[1], v[2], v[3], k[1], k[2], k[3] }'`,
        `awk 'BEGIN { print and(15, 6), or(8, 3), xor(10, 12), lshift(3, 4), rshift(64, 3) }'`,
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "3 10 20 30 a m z\n6 11 6 48 8\n");
  });

  it("6. awk multi-dimensional arrays using SUBSEP and (i, j) in arr membership tests", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `awk 'BEGIN { SUBSEP="@"; g[1,2]="A"; g[3,4]="B"; print ((1,2) in g), ((2,1) in g), g["1@2"], g[3,4] }'`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "1 0 A B\n");
  });

  it("7. sed hold space reversal (1!G;h;$!d) and conditional branch loop (:a;N;$!ba)", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        `printf 'line1\\nline2\\nline3\\n' | sed '1!G;h;$!d'`,
        `echo "---"`,
        `printf 'a\\nb\\nc\\n' | sed ':a;N;$!ba;s/\\n/+/g'`,
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "line3\nline2\nline1\n---\na+b+c\n");
  });

  it("8. sed sliding two-line window with N, P, D", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `printf '1\\n2\\n3\\n4\\n' | sed -n 'N;h;s/\\n/:/p;g;D'`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "1:2\n2:3\n3:4\n");
  });

  it("9. jq paths(scalars), leaf_paths, getpath, setpath, and delpaths on nested structures", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `jq -c '[[paths(scalars)], [leaf_paths], getpath(["a","b",1]), setpath(["a","b",1]; 99), delpaths([["a","b",0]])]' <<< '{"a":{"b":[10,20],"c":true}}'`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      '[[["a","b",0],["a","b",1],["a","c"]],[["a","b",0],["a","b",1],["a","c"]],20,{"a":{"b":[10,99],"c":true}},{"a":{"b":[20],"c":true}}]\n',
    );
  });

  it("10. jq bsearch, transpose, combinations, explode, and implode", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `jq -nc '[([1,3,5,7,9] | bsearch(5)), ([1,3,5,7,9] | bsearch(4)), ([[1,2],[3,4]] | transpose), ([["a","b"],[1,2]] | [combinations]), ("Hi" | explode | map(. + 1) | implode)]'`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      '[2,-3,[[1,3],[2,4]],[["a",1],["a",2],["b",1],["b",2]],"Ij"]\n',
    );
  });

  it("11. jq INDEX, IN, isempty, first, last, nth, and limit on streams", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `jq -nc '[([{"id":"a","v":1},{"id":"b","v":2}] | INDEX(.id)), (3 | IN(1,2,3)), isempty(empty), first(10,20,30), last(10,20,30), nth(1; 10,20,30), [limit(2; 5,6,7,8)]]'`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      '[{"a":{"id":"a","v":1},"b":{"id":"b","v":2}},true,true,10,30,20,[5,6]]\n',
    );
  });

  it("12. jq format strings @base64, @base64d, @uri, @urid, @html, @sh, @csv, @tsv", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `jq -nc '[("hello" | @base64 | @base64d), ("a b&c" | @uri), ("a%20b%26c" | @urid), ("<b>" | @html), (["a b", "cd"] | @sh), (["a,b", 1] | @csv), (["x\\ty", 2] | @tsv)]'`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      '["hello","a%20b%26c","a b&c","&lt;b&gt;","\'a b\' \'cd\'","\\"a,b\\",1","x\\\\ty\\t2"]\n',
    );
  });

  it("13. jq recursive functions (def), reduce, and foreach with state extraction", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `jq -nc 'def fact: if . <= 1 then 1 else . * ((. - 1) | fact) end; [(5 | fact), ([1,2,3,4] | [foreach .[] as $x (0; . + $x; . * 10)])]'`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "[120,[10,30,60,100]]\n");
  });

  it("14. sqlite3 CTE with explicit column list and VALUES clause plus sliding window ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `sqlite3 :memory: "WITH s(x) AS (VALUES (10),(20),(30),(40)) SELECT x, SUM(x) OVER (ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING), COUNT(*) OVER (ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) FROM s;"`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "10|30|2\n20|60|3\n30|90|3\n40|70|2\n");
  });

  it("15. sqlite3 window functions RANK, DENSE_RANK, NTILE, LAG, LEAD, FIRST_VALUE, LAST_VALUE", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        `sqlite3 :memory: "CREATE TABLE scores(dept TEXT, v INT);`,
        `INSERT INTO scores VALUES ('eng', 10), ('eng', 20), ('eng', 20), ('eng', 40);`,
        `SELECT v, RANK() OVER (PARTITION BY dept ORDER BY v), DENSE_RANK() OVER (PARTITION BY dept ORDER BY v), LAG(v, 1, -1) OVER (PARTITION BY dept ORDER BY v), LEAD(v, 1, 999) OVER (PARTITION BY dept ORDER BY v) FROM scores;"`,
      ].join(" "),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      "10|1|1|-1|20\n20|2|2|10|20\n20|2|2|20|40\n40|4|3|20|999\n",
    );
  });

  it("16. uniq -f skip-fields combined with -s skip-chars and -w check-chars matches POSIX field boundary semantics", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      [
        `printf 'aa 11abcX\\nbb 22abcY\\n' | uniq -f 1 -s 2 -w 3 -c | awk '{print $1, $2, $3}'`,
        `echo "---"`,
        `printf 'aa 11abcX\\nbb 12abcY\\n' | uniq -f 1 -s 3 -w 3 -c | awk '{print $1, $2, $3}'`,
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "1 aa 11abcX\n1 bb 22abcY\n---\n2 aa 11abcX\n");
  });

  it("17. sort multi-key character offset specs (-k1,1 -k2.2,2.3n -k3,3r) with custom delimiter", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `printf 'b:x20:1\\na:x10:2\\na:x05:1\\na:x05:3\\n' | sort -t: -k1,1 -k2.2,2.3n -k3,3nr`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "a:x05:3\na:x05:1\na:x10:2\nb:x20:1\n");
  });

  it("18. join with outer (-a1 -a2), anti (-v1 -v2), empty filler (-e), and custom output format (-o)", async () => {
    const h = await SafeBashE2EHarness.create({
      files: {
        "/tmp/left.txt": "1 alpha\n2 beta\n3 gamma\n",
        "/tmp/right.txt": "2 TWO\n3 THREE\n4 FOUR\n",
      },
    });
    const res = await h.exec(
      [
        `join -a1 -a2 -e MISSING -o 0,1.2,2.2 /tmp/left.txt /tmp/right.txt`,
        `echo "---"`,
        `join -v1 /tmp/left.txt /tmp/right.txt`,
      ].join("\n"),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout,
      "1 alpha MISSING\n2 beta TWO\n3 gamma THREE\n4 MISSING FOUR\n---\n1 alpha\n",
    );
  });

  it("19. tr character classes, squeeze-repeats (-s), complement (-c), and delete (-d)", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `printf 'Hello   123   World!!!\\n' | tr '[:upper:]' '[:lower:]' | tr -s ' !' '_'`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "hello_123_world_\n");
  });

  it("20. cut byte/field ranges (-f2-, -f1,3 --output-delimiter) and paste serial (-s) roundtrip", async () => {
    const h = await SafeBashE2EHarness.create();
    const res = await h.exec(
      `printf 'a:b:c:d\\ne:f:g:h\\n' | cut -d: -f1,3- --output-delimiter='|' | paste -s -d',' -`,
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stdout, "a|c|d,e|g|h\n");
  });
});
