export interface TextCase {
  name: string;
  tool: "sed" | "awk" | "pipeline";
  feature: string;
  args: string[];
  stdin?: string;
  files?: Record<string, string>;
  script?: string;
  chunkWidth?: number;
  nativeExitCode?: number;
}

export const encoded = (text: string | Uint8Array): string => Buffer.from(text).toString("base64");
export const cases: TextCase[] = [];
const add = (tool: "sed" | "awk", name: string, feature: string, args: string[], stdin = "", files: Record<string, string | Uint8Array> = {}) => {
  cases.push({ name: `${tool}-${name}`, tool, feature, args, stdin: encoded(stdin), files: Object.fromEntries(Object.entries(files).map(([path, data]) => [path, encoded(data)])) });
};

for (const address of ["1", "$", "2,3", "3,1", "/start/,/end/", "/start/,/start/"]) {
  for (const action of ["p", "!p", "d", "!d"]) {
    for (const ending of ["\n", ""]) add("sed", `address-${cases.length}`, "sed.address-matrix", ["-n", `${address}${action}`], `first\nstart\nend\nstart\nlast${ending}`);
  }
}

for (const [name, program, stdin] of [
  ["range-resumes-after-n", "2,3{n;p;}", "1\n2\n3\n4\n5\n"],
  ["range-change-repeated", "/a/,/b/c\\\nchanged", "a\nx\nb\nc\na\nb\n"],
  ["range-change-single-match", "/a/,/a/c\\\nchanged", "a\nx\na\nz\n"],
  ["delete-restarts-addressed-group", "N;/a/{P;D;};p", "a\nb\nc\nd\n"],
  ["next-at-unterminated-eof", "n;p", "one"],
  ["append-next-order", "1a\\\nqueued\nn;p", "one\ntwo\nthree\n"],
  ["append-delete-order", "1a\\\nqueued\nd", "one\ntwo\n"],
  ["hold-survives-delete", "1{h;d;};G;p", "one\ntwo\n"],
  ["hold-leading-empty", "H;g;p", "one\ntwo\n"],
  ["exchange-initial-empty", "x;p;x;p", "one\n"],
  ["branch-test-reset", "s/a/b/;t first\nb done\n:first\nt wrong\np;b done\n:wrong\ns/.*/WRONG/;p\n:done", "a\n"],
  ["branch-after-failed-substitution", "s/a/b/;s/x/y/;t yes\nb done\n:yes\np\n:done", "a\n"],
  ["empty-regex-address-reuse", "/a/s//A/;/b/s//B/", "ab\nba\n"],
  ["empty-regex-skipped-command", "/z/s/a/x/;s//Y/", "a\nz\n"],
  ["alternate-address-delimiter", "\\#a/b#p", "a/b\na-b\n"],
  ["brace-negation", "/drop/!{s/a/A/g;p;}", "drop a\nkeep a\n"],
  ["repeated-files-empty-middle", "$p", ""],
] as const) add("sed", name, "sed.control", ["-n", program], stdin);

for (const [pattern, replacement, flags, stdin] of [
  ["(a|ab)", "[\\1]", "g", "ababa\n"],
  ["(a*)(a*)", "[\\1][\\2]", "", "aaa\n"],
  ["((a|aa)*)", "[\\1][\\2]", "", "aaaa\n"],
  ["a*", "X", "g", "baaacaa\n"],
  ["x*", "X", "2", "abc\n"],
  ["^|$", "X", "g", "abc\n\n"],
  ["[^[:digit:]]+", "&-&", "g", "ab12cd\n"],
  ["[]a]+", "X", "g", "]aa]\n"],
  ["[-a]+", "X", "g", "a-a\n"],
  ["a{0,2}", "X", "g", "aaab\n"],
  ["(ab)?c", "[\\1]", "g", "abc c\n"],
  ["a", "\\&", "g", "banana\n"],
] as const) add("sed", `regex-${cases.length}`, "sed.regex", ["-E", `s/${pattern}/${replacement}/${flags}`], stdin);

add("sed", "script-comment-after-label", "sed.parser", [":again\n# comment\ns/aa/a/\nt again"], "aaaa\n");
add("sed", "script-first-line-quiet", "sed.parser", ["#n\n2p"], "a\nb\n");
add("sed", "script-file-order", "sed.script-files", ["-f", "first", "-e", "s/b/c/", "input"], "", { first: "s/a/b/\n", input: "a\n" });
add("sed", "program-named-like-option", "sed.options", ["-n", "-e", "p", "--", "-input"], "", { "-input": "preserve\n" });
add("sed", "file-boundary-no-newline", "sed.files", ["-n", "=;p", "first", "empty", "last"], "", { first: "one", empty: "", last: "two\n" });
add("sed", "file-final-address", "sed.files", ["-n", "$p", "first", "last"], "", { first: "a\n", last: "b\n" });
add("sed", "inplace-quiet-truncates-by-request", "sed.in-place", ["-ni.bak", "s/a/b/", "input"], "", { input: "a\n" });
add("sed", "inplace-empty-file", "sed.in-place", ["-i.bak", "s/a/b/", "input"], "", { input: "" });
add("sed", "inplace-quit-per-file", "sed.in-place", ["-i.bak", "1q", "first", "last"], "", { first: "a\nb\n", last: "c\nd\n" });
add("sed", "inplace-existing-backup", "sed.in-place", ["-i.bak", "s/a/b/", "input"], "", { input: "a\n", "input.bak": "old backup\n" });
add("sed", "read-command-gap", "sed.file-read", ["1r extra"], "a\nb\n", { extra: "extra\n" });
add("sed", "write-command-gap", "sed.file-write", ["-n", "w written"], "a\nb\n");
add("sed", "list-command-gap", "sed.list", ["-n", "l"], "a\tb\n");
add("sed", "pattern-backreference-gap", "sed.regex-backreference", ["s/\\([a-z]*\\)-\\1/same/"], "abc-abc\n");
for (const width of [1, 2, 7, 4096]) {
  cases.push({ name: `sed-binary-chunks-${width}`, tool: "sed", feature: "sed.bytes", args: ["s/a/Z/g"], stdin: encoded(Uint8Array.of(255, 97, 0, 128, 10, 97)), chunkWidth: width });
  cases.push({ name: `sed-unicode-c-locale-${width}`, tool: "sed", feature: "sed.bytes", args: ["s/é/Ω/g"], stdin: encoded("préfixe é 🐈\n"), chunkWidth: width });
}

for (const [name, program, stdin] of [
  ["fields-default-whitespace", "{ print NF, $1, $NF }", "  a  b\t c \n\nlast\n"],
  ["field-assignment-rebuilds-record", 'BEGIN{OFS="|"} {$2="X";print $0,NF}', "a b c\n"],
  ["record-assignment-rebuilds-fields", '{$0="a:b:c";print NF,$2}', "ignored\n"],
  ["nf-extending-clearing", 'BEGIN{OFS="|"} {NF=5;print $0;NF=1;print $0}', "a b\n"],
  ["regex-pattern-and-default-action", "/keep/", "keep:a\nskip:b\nkeep:c\n"],
  ["range-pattern-restarts", '/start/,/end/ {print NR,$0}', "start\nx\nend\ngap\nstart\nend\n"],
  ["begin-end-empty-input", 'BEGIN{print "begin"} END{print NR,"end"}', ""],
  ["next-still-counts-records", 'NR%2 {next} {print NR,$0} END{print NR}', "a\nb\nc\nd\n"],
  ["numeric-string-comparison", '{print ($1==0),($1=="0"),($1<10),($1<"10")}', "0\n00\n2\nabc\n"],
  ["arithmetic-assignment-precedence", 'BEGIN{x=2;print x++ + ++x, x;print -2^2,2^3^2}', ""],
  ["short-circuit-side-effects", 'BEGIN{x=0;print (0 && ++x),(1 || ++x),x}', ""],
  ["concatenation-precedence", 'BEGIN{x=2;print "pre" x+1 "post"}', ""],
  ["array-membership-delete", 'BEGIN{a["x"]=3;print ("x" in a),("y" in a);delete a["x"];print ("x" in a)}', ""],
  ["associative-aggregation", '{sum[$1]+=$2} END{print sum["a"],sum["b"]}', "a 2\nb 3\na 4\n"],
  ["multidimensional-array", 'BEGIN{a[1,2]="x";print a[1,2],((1,2) in a)}', ""],
  ["for-in-order-independent-count", 'BEGIN{a["a"]=1;a["b"]=2;for(k in a){sum+=a[k];count++}print sum,count}', ""],
  ["split-clears-existing-array", 'BEGIN{a[9]="stale";n=split("a:b:c",a,":");print n,a[2],(9 in a)}', ""],
  ["for-while-break-continue", 'BEGIN{for(i=0;i<8;i++){if(i==2)continue;if(i==6)break;s+=i}while(s<20)s++;print s}', ""],
  ["do-while", 'BEGIN{i=0;do{i++}while(i<3);print i}', ""],
  ["function-array-reference", 'function f(a,x){a[x]++;return a[x]} BEGIN{print f(a,"x"),f(a,"x"),a["x"]}', ""],
  ["recursive-function", 'function f(n){return n<2?1:n*f(n-1)} BEGIN{print f(6)}', ""],
  ["function-local-extra-parameter", 'function f(x, temp){temp=x+1;return temp} BEGIN{temp=99;print f(3),temp}', ""],
  ["sub-gsub-replacement-count", '{count=gsub(/a/,"[&]");print count,$0}', "banana\n"],
  ["sub-target-field", '{sub(/a/,"X",$2);print $0}', "a banana\n"],
  ["match-rstart-rlength", '{print match($0,/a+/),RSTART,RLENGTH}', "baaac\nnone\n"],
  ["substr-index-length", '{print length($0),index($0,"bc"),substr($0,2,3)}', "abcdef\n"],
  ["sprintf-printf-width", 'BEGIN{printf "<%08.3d>|<%.0d>|%s\\n",12,0,sprintf("%04d",7)}', ""],
  ["exit-runs-end", 'BEGIN{print "begin";exit 7} END{print "end"}', ""],
  ["end-overrides-exit-status", 'BEGIN{exit 7} END{exit 3}', ""],
  ["paragraph-record-separator", 'BEGIN{RS=""} {print NR,NF,$1,$NF}', "\nalpha beta\ngamma\n\ndelta\n\n"],
  ["record-separator-colon", 'BEGIN{RS=":";ORS="|"} {print NR,$0}', "one:two::last"],
  ["redirection-and-close", 'BEGIN{print "one" > "written";close("written");print "two" >> "written"}', ""],
  ["getline-from-file", 'BEGIN{while((getline value < "extra")>0)print value;close("extra")}', ""],
  ["unicode-byte-length-c-locale", '{print length($0),substr($0,1,2)}', "éΩ\n"],
] as const) {
  add("awk", name, `awk.${name.split("-")[0]}`, [program], stdin, name === "getline-from-file" ? { extra: "first\nsecond\n" } : {});
  if (name === "exit-runs-end") cases.at(-1)!.nativeExitCode = 7;
  if (name === "end-overrides-exit-status") cases.at(-1)!.nativeExitCode = 3;
}
add("awk", "fs-flag", "awk.flags", ["-F", ":", "{print NF,$2}"], "a:b:c\n:a:\n");
add("awk", "v-variable-before-begin", "awk.flags", ["-v", "VALUE=007", "BEGIN{print VALUE,VALUE+0}"], "");
add("awk", "assignment-operands-between-files", "awk.assignments", ["BEGIN{print x} {print FNR,NR,x,$0}", "x=first", "one", "x=second", "two"], "", { one: "a\nb\n", two: "c\n" });
add("awk", "multiple-program-files", "awk.script-files", ["-f", "first.awk", "-f", "last.awk"], "a\nb\n", { "first.awk": "{total+=length($0)}\n", "last.awk": "END{print total}\n" });
add("awk", "field-separator-regex", "awk.fields", ["-F", "[,:]+", "{print NF,$1,$2,$3}"], "a::b,c\n");

cases.push({ name: "pipeline-sed-sort-uniq", tool: "pipeline", feature: "pipeline.sed", args: [], script: "sed -n '/^keep:/{s/^keep://;p;}' | sort | uniq | tee output", stdin: encoded("keep:pear\nskip:no\nkeep:apple\nkeep:pear\n") });
cases.push({ name: "pipeline-sed-awk-aggregate", tool: "pipeline", feature: "pipeline.sed-awk", args: [], script: "sed 's/:/ /g' | awk '{sum[$1]+=$2} END{print sum[\"a\"],sum[\"b\"]}' | tee output", stdin: encoded("a:2\nb:3\na:4\n") });
cases.push({ name: "pipeline-awk-sed-format", tool: "pipeline", feature: "pipeline.awk-sed", args: [], script: "awk '$2>=2 {printf \"%s:%d\\n\",$1,$2*3}' | sed 's/:/ = /' | sort | tee output", stdin: encoded("pear 2\napple 4\nplum 1\n") });
