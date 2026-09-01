import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { byteChunks, makeFileSystem, runVirtual, type OracleCase } from "./helpers.js";

const cases: Record<string, OracleCase> = {
  "BEGIN prints without consuming input": { args: ['BEGIN { print "hello", 2 + 3 }'] },
  "quoted operators and keywords remain data": { args: ['BEGIN { print ">", ">>", "}", ";"; print "value" "+" "if"; constructor=3; print constructor }'] },
  "END sees record count": { args: ['END { print NR }'], stdin: "one\ntwo\nlast" },
  "field arithmetic and printf totals": { args: ['{ total += $2 } END { printf "rows=%d total=%d\\n", NR, total }'], stdin: "apple 2\npear 5\napple 3\n" },
  "record and field builtins": { args: ['{ print NR, FNR, NF, $1, $NF }'], stdin: "  a  b \n\nx y z\n" },
  "field separator option preserves empty fields": { args: ["-F:", '{ print NF, "[" $1 "]", "[" $3 "]" }'], stdin: ":two:\na:b:c\n" },
  "regex field separator": { args: ["-F", "[,;]+", '{ print NF, $1, $2, $3 }'], stdin: "a,,b;c\n" },
  "OFS and ORS control print": { args: ['BEGIN { OFS=":"; ORS="|" } { print $2, $1 }'], stdin: "a b\nc d\n" },
  "field assignment rebuilds record": { args: ['BEGIN { OFS=":" } { $2=toupper($2); $4="last"; print NF, $0 }'], stdin: "a b\n" },
  "NF truncation and extension rebuild record": { args: ['{ NF=2; print $0; NF=4; print "[" $0 "]" }'], stdin: "a b c\n" },
  "record assignment resplits fields": { args: ['{ $0="new fields here"; print NF, $2 }'], stdin: "original\n" },
  "regex pattern default action": { args: ["/^keep:/"], stdin: "skip:a\nkeep:b\nkeep:c\n" },
  "relational and regex expression patterns": { args: ['$2 >= 3 && $1 !~ /^skip/ { print $1 }'], stdin: "pear 4\nskip 9\napple 2\n" },
  "ranges can end on their first record": { args: ['/x/,/x/ { print $0 }'], stdin: "x\nbetween\nx\n" },
  "record range includes endpoints": { args: ['NR==2,NR==4 { print $0 }'], stdin: "a\nb\nc\nd\ne\n" },
  "next skips subsequent rules": { args: ['/skip/ { next } { total += $1 } END { print total }'], stdin: "2\nskip\n3\n" },
  "arithmetic precedence and exponentiation": { args: ['BEGIN { print 2+3*4, 2^3^2, -2^2, (9%4), 7/2 }'] },
  "assignment and increments": { args: ['BEGIN { x=2; print x++, ++x; x*=3; x-=2; print x }'] },
  "field postfix increment": { args: ['{ print $1++, $1 }'], stdin: "2\n" },
  "numeric strings retain original text": { args: ['{ print $1, $1+0, ($1==3), ($1=="03"), ("03"==3) }'], stdin: "03\n" },
  "truth distinguishes string literals and numeric fields": { args: ['{ print ("0" ? "literal" : "bad"), ($1 ? "bad" : "numeric"), (missing == ""), (missing == 0) }'], stdin: "0\n" },
  "implicit concatenation and conditional expressions": { args: ['{ label="item:" $1; print label, ($2>2 ? "large" : "small") }'], stdin: "pear 3\napple 1\n" },
  "printf flags and precision": { args: ['BEGIN { printf "%05d|%-5.3s|%.2f|%x|%o|%%\\n", -3, "abcdef", 1.25, 15, 8 }'] },
  "printf star widths and sprintf": { args: ['BEGIN { print sprintf("[%*.*f]", 7, 2, 1.5); printf("%s:%d\\n", "x", 2) }'] },
  "for loops over fields": { args: ['{ for (fieldNumber=1; fieldNumber<=NF; fieldNumber++) total += $fieldNumber } END { print total }'], stdin: "1 2 3\n4 5\n" },
  "regex beginning with equals and division assignment": { args: ['/=+/ { value=12; value/=3; print value,$0 }'], stdin: "no\nyes=ok\n" },
  "non-ASCII bytes are not whitespace": { args: ['{ print NF,length($1),length($2) }'], stdin: "\u00a0one two\u00a0\n" },
  "while and do loops": { args: ['BEGIN { count=0; while(count<3) { sum+=count; count++ } do { sum++; count-- } while(count>0); print sum }'] },
  "if else break and continue": { args: ['BEGIN { for(i=0;i<8;i++) { if(i==1) continue; if(i==5) break; if(i%2==0) total+=i; else total+=10 } print total }'] },
  "associative counters": { args: ['{ counts[$1]++ } END { print counts["apple"], counts["pear"], length(counts) }'], stdin: "apple\npear\napple\n" },
  "array membership deletion and enumeration": { args: ['BEGIN { values["a"]=2; values["b"]=3; print ("a" in values); delete values["a"]; for(key in values) sum+=values[key]; print sum, ("a" in values); delete values; print length(values) }'] },
  "multidimensional keys and SUBSEP": { args: ['BEGIN { values["a",2]=7; print values["a",2], (("a",2) in values) }'] },
  "split replaces arrays and converts numeric fields": { args: ['BEGIN { values["old"]=9; count=split("1:2:3",values,":"); print count, values[1]+values[3], ("old" in values) }'] },
  "split regex and whitespace separators": { args: ['BEGIN { print split(" a  b ", words), words[1], words[2]; print split("a,,b;c", fields, /[,;]+/), fields[3] }'] },
  "match updates RSTART and RLENGTH": { args: ['{ print match($0, /[0-9]+/), RSTART, RLENGTH; print match($0, /absent/), RSTART, RLENGTH }'], stdin: "abc123x\n" },
  "sub and gsub update records and fields": { args: ['{ first=sub(/a/,"A"); total=gsub(/b/,"[&]"); print first,total,NF,$0 }'], stdin: "a b bb\n" },
  "substitution with explicit variable target": { args: ['BEGIN { value="banana"; print gsub(/a/,"X",value),value; print sub(/none/,"x",value),value }'] },
  "string utilities": { args: ['BEGIN { print substr("abcdef",2,3), index("banana","na"), length("hello"), tolower("A!B"), toupper("a!b") }'] },
  "math utilities": { args: ['BEGIN { printf "%.2f %.2f %.2f %.2f %d\\n", sqrt(9), exp(0), log(1), atan2(0,1), int(-2.9) }'] },
  "functions and recursion": { args: ['function factorial(value) { if(value<=1) return 1; return value*factorial(value-1) } BEGIN { print factorial(5) }'] },
  "function local parameters and array references": { args: ['function fill(values, local) { for(local=1;local<=3;local++) values[local]=local*2 } BEGIN { local="outer"; fill(items); print items[1],items[3],local }'] },
  "v variables precede BEGIN and operand assignments follow it": { args: ["-v", "value=early", 'BEGIN { print value } { print value,$0 } END { print value }', "value=later"], stdin: "record\n" },
  "multiple files reset FNR and retain NR": { args: ['{ print FILENAME,FNR,NR,$0 }', "first", "second"], files: { first: "a\nb\n", second: "c\n" } },
  "ARGV can skip input files": { args: ['BEGIN { ARGV[1]="" } { print FILENAME,$0 }', "skip", "keep"], files: { skip: "bad\n", keep: "good\n" } },
  "environment array": { args: ['BEGIN { print ENVIRON["LC_ALL"]; print "[" ENVIRON["UNSET_ORACLE_VARIABLE"] "]" }'] },
  "single-byte RS": { args: ['BEGIN { RS=":" } { print NR,"[" $0 "]" }'], stdin: "one::three:last" },
  "paragraph records": { args: ['BEGIN { RS="" } { print NR,NF,"[" $0 "]" }'], stdin: "\n\none two\nthree\n\n\nfour five\n\n" },
  "program files concatenate": { args: ["-f", "one.awk", "-f", "two.awk", "input"], files: { "one.awk": "{ sum+=$1 }\n", "two.awk": "END { print sum }\n", input: "2\n3\n" } },
  "virtual output redirection and close": { args: ['{ print $1 > "result"; print $2 >> "appended" } END { close("result"); print "reset" > "result" }'], stdin: "a b\nc d\n", files: { result: "old\n", appended: "before\n" } },
  "exit still runs END": { args: ['{ print $0; exit 7 } END { print "end",NR }'], stdin: "first\nsecond\n", expectedExitCode: 7 },
  "C-locale byte strings": { args: ['{ print length($0); printf "%s",substr($0,1,1) }'], stdin: "é\n" },
};

for (const [name, program, expected] of [
  ["empty program", "", ""],
  ["only repeated mixed separators", "\n;;\n;\n", ""],
  ["mixed statement and rule separators", '\n;;BEGIN { ;\n; print "first";\n;; print "second"\n;; };\n;END { print "last" };;\n', "first\nsecond\nlast\n"],
  ["empty action", "\nBEGIN\n\n{\n;;\n}\n", ""],
  ["semicolon remains an empty conditional body", 'BEGIN { if (0); print "after"; while (0); print "done" }', "after\ndone\n"],
  ["literal separators", 'BEGIN { print ";", "a;b", "\\n"; print "after" }', "; a;b \n\nafter\n"],
  ["newlines before action and in conditions", 'BEGIN\n\n{ if (\n\n1\n\n)\n\n print "yes"; else\n\n print "no" }', "yes\n"],
  ["newlines before function body", 'function value()\n\n{ return 7 }\n\nBEGIN { print value() }', "7\n"],
] as const) {
  test(`Group E awk separator control: ${name}`, async () => {
    const result = await runVirtual("awk", { args: [program], stdin: "input\n" });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), expected);
    assert.equal(result.stderr.length, 0);
    assert.deepEqual(result.files, {});
  });
}

for (const [name, program] of [
  ["before BEGIN action", 'BEGIN; { print "bad" > "created" }'],
  ["before function body", 'function value(); { return 7 } BEGIN { print "bad" > "created" }'],
  ["before condition expression", 'BEGIN { print "bad" > "created"; if (;1) print "bad" }'],
  ["after condition expression", 'BEGIN { print "bad" > "created"; if (1;) print "bad" }'],
] as const) {
  test(`Group E awk rejects semicolon ${name} before effects`, async () => {
    let consumed = false;
    const source = (async function* () { consumed = true; yield Buffer.from("input\n"); })();
    const result = await runVirtual("awk", { args: [program] }, {}, source);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout.length, 0);
    assert.notEqual(result.stderr.length, 0);
    assert.deepEqual(result.files, {});
    assert.equal(consumed, false);
  });
}

test("awk rejects unsupported syntax and unknown calls before input and output effects", async () => {
  for (const program of [
    'BEGIN { print "bad" > "created"; system("never execute") }',
    'BEGIN { print "bad"; getline value }',
    'BEGIN { print "bad" | "never execute" }',
    'BEGIN { print "bad"; missing_function() }',
    'BEGIN { print "bad"; break }',
    'BEGIN { print "bad"; next }',
    'BEGIN { print "bad"; values=split("x", "not-an-array") }',
    'BEGIN { print "bad"; value=match("x", /(unterminated/) }',
    'BEGIN { print "bad"; printf "%q", "x" }',
    'BEGIN { print "bad"; value=sprintf("%q", "x") }',
    'BEGIN { print "bad"; index=1 }',
  ]) {
    let consumed = false;
    const source = (async function* () { consumed = true; yield Buffer.from("input\n"); })();
    const result = await runVirtual("awk", { args: [program] }, {}, source);
    assert.equal(result.exitCode, 2, program);
    assert.equal(result.stdout.length, 0, program);
    assert.deepEqual(result.files, {}, program);
    assert.equal(consumed, false, program);
  }
});

test("awk loops, recursive functions and regex matching are bounded", async () => {
  for (const program of ['BEGIN { while(1) value++ }', 'function repeat() { return repeat() } BEGIN { repeat() }', '{ print ($0 ~ /(a+)+b/) }']) {
    const result = await runVirtual("awk", { args: [program], stdin: "a".repeat(1000) }, { maxSteps: 1000 });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr.toString(), /limit/u);
  }
});

test("awk streams one-byte records and composes with sed and existing virtual tools", async () => {
  const streamed = await runVirtual("awk", { args: ['{ sum+=$2 } END { print NR,sum }'] }, {}, byteChunks("one 2\ntwo 3"));
  assert.equal(streamed.stdout.toString(), "2 5\n");
  const fs = await makeFileSystem();
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(textProgramCommands());
  const result = await shell.exec("printf 'skip:z 99\\nkeep:pear 2\\nkeep:apple 3\\nkeep:pear 4\\n' | sed -n 's/^keep://p' | awk '{ sums[$1]+=$2 } END { for(name in sums) printf \"%s:%d\\n\",name,sums[name] }' | sort | tee totals");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "apple:3\npear:6\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/totals")), result.stdout);
});
