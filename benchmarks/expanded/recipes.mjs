import assert from "node:assert/strict";

export const defaultNames = "true false echo pwd basename dirname printf mkdir touch cp mv rm rmdir ln readlink realpath ls cat head tail wc tee tr sort uniq cut grep test [ env xargs find sed awk jq rg base64 base32 xxd od sha256sum sha1sum md5sum cksum gzip gunzip zcat diff patch chmod stat mktemp tar paste comm join".split(" ");
const binary = Buffer.from([0, 1, 9, 10, 65, 127, 128, 255]);
const text = "alpha\nbeta\nalpha\n";
const lines = "1 alice\n2 bob\n";
const row = (label, script, files = {}, stdin = "", options = {}) => ({ label, script, files, stdin, ...options });
const tools = {
  true: [row("empty", "true"), row("arguments", "true ignored"), row("conditional", "true && printf yes")],
  false: [row("empty", "false", {}, "", { nativeExit: 1 }), row("arguments", "false ignored", {}, "", { nativeExit: 1 }), row("conditional", "false || printf no")],
  echo: [row("multiple", "echo alpha beta"), row("no-newline", "echo -n alpha"), row("escapes", "echo -e 'a\\tb\\n'")],
  pwd: [row("logical", "pwd"), row("physical", "mkdir child; cd child; pwd -P"), row("symlink", "mkdir target; ln -s target alias; cd alias; pwd -L")],
  basename: [row("suffix", "basename path/file.ts .ts"), row("multiple", "basename -a dir/one dir/two"), row("suffix-option", "basename -s .txt -a a.txt b.txt")],
  dirname: [row("nested", "dirname a/b/file"), row("multiple", "dirname a/b x/y"), row("nul", "dirname -z a/b")],
  printf: [row("formats", "printf '%s:%04d:%x\\n' value 7 255"), row("binary", "printf '\\000\\377A\\n'"), row("reuse", "printf '<%s>\\n' one two three")],
  mkdir: [row("parents", "mkdir -p one/two one/three"), row("mode", "mkdir -m 700 private", {}, "", { modes: true }), row("existing-parents", "mkdir -p one; mkdir -p one/two; mkdir -p one")],
  touch: [row("create", "touch fresh"), row("no-create", "touch -c absent"), row("reference", "touch -r reference target; stat -c '%Y' target", { reference: "ref", target: "old" }, "", { fileTimes: { target: 1_600_000_000_000 } })],
  cp: [row("overwrite", "cp source target", { source: binary, target: "old" }), row("recursive", "cp -R tree copied", { "tree/a": "a", "tree/sub/b": "b" }), row("preserve-link", "ln -s source link; cp -P link copy; readlink copy", { source: "source" })],
  mv: [row("rename", "mv source target", { source: binary }), row("no-clobber", "mv -n source target", { source: "new", target: "old" }), row("into-directory", "mkdir target; mv source target", { source: "new" })],
  rm: [row("file", "rm source", { source: "delete" }), row("recursive", "rm -r tree", { "tree/sub/file": "delete" }), row("empty-directory", "mkdir empty; rm -d empty")],
  rmdir: [row("empty", "mkdir empty; rmdir empty"), row("parents", "mkdir -p a/b/c; rmdir -p a/b/c"), row("literal", "mkdir -- -literal; rmdir -- -literal")],
  ln: [row("hardlink", "ln source alias; printf x >> alias; cat source", { source: "start" }), row("symlink", "ln -s source alias; readlink alias", { source: binary }), row("force", "ln -sf source alias; readlink alias", { source: "new", alias: "old" })],
  readlink: [row("target", "ln -s source alias; readlink alias", { source: "x" }), row("no-newline", "ln -s source alias; readlink -n alias", { source: "x" }), row("canonical", "ln -s source alias; readlink -f alias", { source: "x" })],
  realpath: [row("existing", "realpath source", { source: "x" }), row("missing-tail", "realpath -m one/../missing/child"), row("relative", "realpath --relative-to=. tree/file", { "tree/file": "x" })],
  ls: [row("names", "ls -1", { beta: "b", alpha: "a" }), row("hidden", "ls -A", { visible: "v", ".hidden": "h" }), row("directory-entry", "mkdir child; ls -d child")],
  cat: [row("binary-stdin", "cat", {}, binary), row("number", "cat -n input", { input: "one\n\ntwo\n" }), row("multiple-stdin", "cat left - right", { left: "left\n", right: "right\n" }, "middle\n")],
  head: [row("lines", "head -n 2", {}, text), row("bytes", "head -c 5", {}, binary), row("negative", "head -n -1", {}, text)],
  tail: [row("lines", "tail -n 2", {}, text), row("from-line", "tail -n +2", {}, text), row("bytes", "tail -c 3", {}, binary)],
  wc: [row("bytes", "wc -c", {}, binary), row("words-lines", "wc -lw", {}, "one two\nthree\n"), row("unicode", "wc -m", {}, "café\n")],
  tee: [row("file", "tee copy", {}, binary), row("append", "tee -a copy", { copy: "old\n" }, "new\n"), row("multiple", "tee first second", {}, "both\n")],
  tr: [row("ranges", "tr a-z A-Z", {}, "hello\n"), row("delete", "tr -d '0-9'", {}, "a1b2c3\n"), row("squeeze", "tr -s ' ' '\\n'", {}, "a   b c\n")],
  sort: [row("numeric", "sort -n", {}, "10\n2\n-1\n"), row("keys", "sort -t: -k2,2n", {}, "a:10\nb:2\nc:1\n"), row("nul-unique", "sort -zu", {}, Buffer.from("b\0a\0b\0"))],
  uniq: [row("counts", "uniq -c", {}, "a\na\nb\n"), row("duplicates", "uniq -d", {}, "a\na\nb\nc\nc\n"), row("case-fold", "uniq -i", {}, "Alpha\nalpha\nBeta\n")],
  cut: [row("fields", "cut -d: -f2,3", {}, "a:b:c\nx:y:z\n"), row("bytes", "cut -b2-4", {}, "abcdef\n"), row("complement", "cut -d: -f2 --complement", {}, "a:b:c\n")],
  grep: [row("fixed", "grep -F 'a.b'", {}, "a.b\naxb\n"), row("extended-number", "grep -En '^(alpha|beta)$'", {}, text), row("inverse-count", "grep -vc alpha", {}, text)],
  test: [row("string", "test x = x"), row("numeric-false", "test 2 -gt 7", {}, "", { nativeExit: 1 }), row("file", "test -s input", { input: "x" })],
  "[": [row("string", "[ x = x ]"), row("numeric-false", "[ 2 -gt 7 ]", {}, "", { nativeExit: 1 }), row("file", "[ -s input ]", { input: "x" })],
  env: [row("clean", "env -i A=1 B=2"), row("unset", "env -i A=1 B=2 env -u A"), row("nested", "env MESSAGE=hello bash -c 'printf %s \"$MESSAGE\"'")],
  xargs: [row("batch", "xargs -n2 printf '<%s>\\n'", {}, "a b c\n"), row("nul", "xargs -0 printf '<%s>\\n'", {}, Buffer.from("a b\0c\0")), row("replace", "xargs -I{} printf '[%s]\\n' '{}'", {}, "a b\nc\n")],
  find: [row("name", "find tree -type f -name '*.ts' | sort", { "tree/a.ts": "a", "tree/b.txt": "b", "tree/sub/c.ts": "c" }), row("exec", "find tree -type f -exec cat {} \\;", { "tree/a": "a\n" }), row("nul", "find tree -type f -print0 | sort -z", { "tree/a b": "x", "tree/c": "y" })],
  sed: [row("substitute", "sed 's/alpha/A/g'", {}, text), row("range", "sed -n '2,3p'", {}, text), row("in-place", "sed -i 's/old/new/g' input", { input: "old old\n" })],
  awk: [row("fields", "awk -F: '{print $2}'", {}, "a:one\nb:two\n"), row("arrays", "awk '{count[$1]++} END{print count[\"a\"],count[\"b\"]}'", {}, "a\nb\na\n"), row("variables", "awk -v prefix=X '{print prefix NR \":\" $0}'", {}, "one\ntwo\n")],
  jq: [row("map", "jq -c 'map(. * 2)'", {}, "[1,2,3]"), row("raw", "jq -Rsc 'split(\"\\n\")'", {}, "a\nb\n"), row("join", "jq -r 'join(\":\")'", {}, '["a",2,true,null]')],
  rg: [row("fixed", "rg -F 'a.b' -", {}, "a.b\naxb\n"), row("files", "rg -l beta tree | sort", { "tree/first": "alpha", "tree/second": "beta" }), row("empty-stdin", "rg match", {}, "", { nativeExit: 1 })],
  base64: [row("encode", "base64", {}, binary), row("decode", "base64 -d", {}, "AP9BCg==\n"), row("wrap", "base64 -w4", {}, "abcdefghi")],
  base32: [row("encode", "base32", {}, binary), row("decode", "base32 -d", {}, "ME======\n"), row("wrap", "base32 -w8", {}, "abcdefghi")],
  xxd: [row("plain", "xxd -p", {}, binary), row("reverse", "xxd -r -p", {}, "00ff410a\n"), row("layout", "xxd -g1 -c4", {}, "abcdef")],
  od: [row("hex", "od -An -tx1 -v", {}, binary), row("decimal", "od -An -tu1 -v", {}, binary), row("skip-count", "od -An -tx1 -j2 -N3", {}, binary)],
  sha256sum: [row("stdin", "sha256sum", {}, "abc"), row("files", "sha256sum first second", { first: "one", second: "two" }), row("check", "sha256sum input > sums; sha256sum -c sums", { input: "check" })],
  sha1sum: [row("stdin", "sha1sum", {}, "abc"), row("files", "sha1sum first second", { first: "one", second: "two" }), row("check", "sha1sum input > sums; sha1sum -c sums", { input: "check" })],
  md5sum: [row("stdin", "md5sum", {}, "abc"), row("files", "md5sum first second", { first: "one", second: "two" }), row("check", "md5sum input > sums; md5sum -c sums", { input: "check" })],
  cksum: [row("stdin", "cksum", {}, "abc"), row("files", "cksum first second", { first: "one", second: "two" }), row("algorithm", "cksum -a sha256 input", { input: "abc" })],
  gzip: [row("roundtrip", "gzip -n -c input | gunzip -c", { input: binary }), row("replace", "gzip -n input; gunzip input.gz", { input: "compress me\n" }), row("level", "gzip -9 -n -c input | gzip -d -c", { input: text.repeat(30) })],
  gunzip: [row("stdin", "gzip -n -c input | gunzip -c", { input: binary }), row("keep", "gzip -n input; gunzip -k input.gz; rm input.gz", { input: text }), row("test", "gzip -n -c input > input.gz; gunzip -t input.gz; rm input.gz", { input: text })],
  zcat: [row("stdin", "gzip -n -c input | zcat", { input: binary }), row("file", "gzip -n -c input > input.gz; zcat input.gz; rm input.gz", { input: text }), row("multiple-members", "gzip -n -c first > both.gz; gzip -n -c second >> both.gz; zcat both.gz; rm both.gz", { first: "first\n", second: "second\n" })],
  diff: [row("equal", "diff left right", { left: text, right: text }), row("unified", "diff -u --label left --label right left right", { left: "one\ntwo\n", right: "one\nthree\n" }, "", { nativeExit: 1 }), row("ignore-space", "diff -w left right", { left: "a b\n", right: "a  b\n" })],
  patch: [row("apply", "patch -s -p0 < change", { input: "old\n", change: "--- input\n+++ input\n@@ -1 +1 @@\n-old\n+new\n" }), row("dry-run", "patch -s --dry-run -p0 < change", { input: "old\n", change: "--- input\n+++ input\n@@ -1 +1 @@\n-old\n+new\n" }), row("reverse", "patch -s -R -p0 < change", { input: "new\n", change: "--- input\n+++ input\n@@ -1 +1 @@\n-old\n+new\n" })],
  chmod: [row("numeric", "chmod 600 input", { input: "private" }, "", { modes: true }), row("symbolic", "chmod u+x,go-r input", { input: "mode" }, "", { modes: true }), row("recursive-reference", "chmod 700 reference; chmod -R --reference=reference tree", { reference: "r", "tree/file": "x" }, "", { modes: true })],
  stat: [row("fields", "stat -c '%n:%s:%a' input", { input: "abc" }), row("follow", "ln -s input alias; stat -L -c '%s:%a' alias", { input: "abc" }), row("timestamp", "stat -c '%Y:%y' input", { input: "time" })],
  mktemp: [row("file", "name=$(mktemp -p tmp item.XXXXXX); test -f \"$name\" && stat -c '%a' \"$name\"; rm \"$name\"", {}, "", { directories: ["tmp"] }), row("directory", "name=$(mktemp -d -p tmp dir.XXXXXX); test -d \"$name\" && stat -c '%a' \"$name\"; rmdir \"$name\"", {}, "", { directories: ["tmp"] }), row("suffix-dry-run", "name=$(mktemp -u -p tmp --suffix=.log item.XXXXXX); test ! -e \"$name\"; printf '%s\\n' \"${name##*.}\"", {}, "", { directories: ["tmp"] })],
  tar: [row("roundtrip", "mkdir out; tar -cf archive.tar input; tar -xf archive.tar -C out; rm archive.tar", { input: binary }), row("list", "tar -cf archive.tar input; tar -tf archive.tar; rm archive.tar", { input: text }), row("gzip-tree", "mkdir out; tar -czf archive.tar.gz tree; tar -xzf archive.tar.gz -C out; rm archive.tar.gz", { "tree/a": text, "tree/b": binary })],
  paste: [row("parallel", "paste left right", { left: "a\nb\n", right: "1\n2\n3\n" }), row("serial", "paste -sd, -", {}, "a\nb\nc\n"), row("nul-shared", "paste -z - -", {}, Buffer.from("a\0b\0c\0d\0"))],
  comm: [row("columns", "comm left right", { left: "a\nb\n", right: "b\nc\n" }), row("intersection", "comm -12 left right", { left: "a\nb\n", right: "b\nc\n" }), row("totals", "comm --total -123 left right", { left: "a\nb\n", right: "b\nc\n" })],
  join: [row("fields", "join left right", { left: lines, right: "1 red\n2 blue\n" }), row("outer", "join -a1 -a2 -e missing -o auto left right", { left: lines, right: "1 red\n3 green\n" }), row("duplicate", "join -t: -o '0,1.2,2.2' left right", { left: "a:one\na:two\n", right: "a:red\na:blue\n" })],
};

const kernel = [
  row("colon", ":; printf ok"), row("cd", "mkdir nested; cd nested; pwd"),
  row("export", "export VALUE=kept; bash -c 'printf %s \"$VALUE\"'"),
  row("local", "VALUE=outer; f(){ local VALUE=inner; printf '%s\\n' \"$VALUE\"; }; f; printf '%s\\n' \"$VALUE\""),
  row("unset", "VALUE=old; unset VALUE; printf '%s' \"${VALUE-unset}\""),
  row("readonly", "readonly VALUE=locked; printf '%s' \"$VALUE\""),
  row("set-shift", "set -- one two three; shift; printf '%s:%s:%s' \"$#\" \"$1\" \"$2\""),
  row("read", "IFS=: read -r left right; printf '<%s><%s>' \"$left\" \"$right\"", {}, "a:b c\n"),
  row("return", "f(){ printf before; return 7; printf after; }; f; printf ':%s' \"$?\""),
  row("exit", "printf before; exit 7; printf after", {}, "", { nativeExit: 7 }),
  row("break", "for value in a b c; do printf %s \"$value\"; break; done"),
  row("continue", "for value in a b c; do if [ \"$value\" = b ]; then continue; fi; printf %s \"$value\"; done"),
  row("command", "echo(){ printf function; }; command echo external"),
  row("type", "type -t printf; type -t cat; f(){ :; }; type -t f"),
  row("bash-c", "bash -c 'printf \"%s:%s:%s\" \"$0\" \"$1\" \"$2\"' named one two"),
  row("sh-c", "sh -c 'printf \"%s:%s\" \"$0\" \"$1\"' named one"),
  row("bash-file", "bash script one two", { script: "printf '%s:%s:%s' \"$0\" \"$1\" \"$2\"\n" }),
  row("sh-file", "sh script one", { script: "printf '%s:%s' \"$0\" \"$1\"\n" }),
  row("executable-file", "./script argument", { script: "printf 'ran:%s' \"$1\"\n" }, "", { fileModes: { script: 0o755 } }),
  row("env-shebang", "./script argument", { script: "#!/usr/bin/env bash\nprintf 'env:%s' \"$1\"\n" }, "", { fileModes: { script: 0o755 } }),
  row("source", "source script; printf '%s' \"$VALUE\"", { script: "VALUE=sourced\n" }),
  row("dot", ". ./script; printf '%s' \"$VALUE\"", { script: "VALUE=dotted\n" }),
  row("eval", "VALUE=world; eval 'printf \"hello %s\" \"$VALUE\"'"),
  row("arithmetic", "VALUE=3; printf '%s' \"$((VALUE*7+2))\""),
  row("parameter", "VALUE=abcabc; printf '%s:%s:%s' \"${VALUE#abc}\" \"${VALUE%abc}\" \"${VALUE//a/X}\""),
  row("substitution", "VALUE=$(printf 'line\\n\\n'); printf '<%s>' \"$VALUE\""),
  row("heredoc", "VALUE=world; cat <<END\nhello $VALUE\nEND"),
  row("here-string", "cat <<< 'one two'"),
  row("pipefail", "set -o pipefail; false | cat", {}, "", { nativeExit: 1 }),
  row("subshell", "VALUE=outer; ( VALUE=inner; printf '%s\\n' \"$VALUE\" ); printf '%s\\n' \"$VALUE\""),
  row("while", "VALUE=0; while [ \"$VALUE\" -lt 3 ]; do printf '%s' \"$VALUE\"; VALUE=$((VALUE+1)); done"),
  row("case", "VALUE=file.ts; case \"$VALUE\" in *.ts) printf typescript;; *) printf other;; esac"),
  row("glob", "printf '<%s>\\n' *.txt", { "b.txt": "b", "a.txt": "a", "other.ts": "x" }),
  row("stderr-redirect", "printf error >&2; printf good > output; cat output"),
  row("append-descriptor", "printf first > output; printf second >> output; cat < output"),
  row("pipeline-stdin", "read -r value; printf '%s\\n' \"$value\" | cat", {}, "from stdin\n"),
];

const composition = [
  row("text-filter", "grep keep | cut -d: -f2 | sort | uniq -c", {}, "keep:b\nkeep:a\nskip:c\nkeep:a\n"),
  row("json-lines", "jq -r '.[] | .name' | sort | paste -sd, -", {}, '[{"name":"bob"},{"name":"alice"}]'),
  row("sed-awk", "sed 's/:/ /g' | awk '{sum+=$2} END{print sum}'", {}, "a:2\nb:5\n"),
  row("binary-roundtrip", "base64 | base64 -d | gzip -n -c | gunzip -c | tee restored", {}, binary),
  row("archive-hash", "mkdir out; tar -cf - tree | tar -xf - -C out; sha256sum out/tree/file", { "tree/file": binary }),
  row("patch-hash", "patch -s -p0 < change; sha256sum input", { input: "old\n", change: "--- input\n+++ input\n@@ -1 +1 @@\n-old\n+new\n" }),
  row("join-cut-paste", "join names colors | cut -d ' ' -f2,3 | paste -sd, -", { names: lines, colors: "1 red\n2 blue\n" }),
  row("find-xargs", "find tree -type f -print0 | sort -z | xargs -0 cat", { "tree/a file": "a\n", "tree/b": "b\n" }),
  row("comm-pipeline", "sort left > sorted; comm -12 sorted right | tr a-z A-Z", { left: "b\na\n", right: "b\nc\n" }),
  row("stdin-file-tee", "cat left - right | tee joined | wc -c", { left: "a", right: "c" }, "b"),
  row("script-data", "bash script < input", { script: "while IFS= read -r value; do printf '[%s]\\n' \"$value\"; done\n", input: "a b\nc\n" }),
  row("metadata-pipeline", "chmod 600 input; stat -c '%a %s' input | awk '{print $1 \":\" $2}'", { input: "abc" }, "", { modes: true }),
];

const network = [
  row("get", "curl -s '{{BASE}}/bytes'"),
  row("post-stdin", "curl -s --data-binary @- '{{BASE}}/echo'", {}, binary),
  row("post-file", "curl -s --data-binary @input '{{BASE}}/echo'", { input: binary }),
  row("json", "curl -s --json '{\"answer\":42}' '{{BASE}}/echo'"),
  row("redirect", "curl -sL '{{BASE}}/redirect'"),
  row("output", "curl -s -o result '{{BASE}}/bytes'"),
  row("fail-body", "curl -s --fail-with-body '{{BASE}}/missing'", {}, "", { nativeExit: 22 }),
  row("auth-writeout", "curl -s -u user:pass -w '\\n%{http_code}\\n' '{{BASE}}/auth'"),
];

export function recipes() {
  assert.deepEqual(Object.keys(tools).sort(), [...defaultNames].sort());
  const result = [];
  const add = (group, command, specimen) => result.push({
    id: `${group}/${command}/${specimen.label}`, group, command, optionFamily: specimen.label,
    script: specimen.script, files: Object.fromEntries(Object.entries(specimen.files).map(([path, bytes]) => [path, Buffer.from(bytes).toString("base64")])),
    stdin: Buffer.from(specimen.stdin).toString("base64"), nativeExit: specimen.nativeExit ?? 0,
    modes: specimen.modes ?? false, directories: specimen.directories ?? [], fileModes: specimen.fileModes ?? {},
    fileTimes: specimen.fileTimes ?? {},
    network: group === "network", stderrPolicy: "exact-after-root-path-projection",
  });
  for (const name of defaultNames) { assert.equal(tools[name].length, 3); for (const specimen of tools[name]) add("command", name, specimen); }
  for (const specimen of kernel) add("kernel", specimen.label, specimen);
  for (const specimen of composition) add("composition", specimen.label, specimen);
  for (const specimen of network) add("network", "curl", specimen);
  assert.equal(kernel.length, 36); assert.equal(composition.length, 12); assert.equal(network.length, 8);
  assert.equal(result.length, 224); assert.equal(new Set(result.map(specimen => specimen.id)).size, result.length);
  return result;
}

export function performanceRecipes() {
  const specimens = [
    row("binary-256k", "cat | tee output | cat", {}, Buffer.from(Array.from({ length: 256 * 1024 }, (_, index) => index % 256))),
    row("sed-10000", "sed 's/^keep://g'", {}, "keep:value\n".repeat(10_000)),
    row("sort-5000", "sort | uniq", {}, Array.from({ length: 5000 }, (_, index) => `value-${(index * 71) % 997}\n`).join("")),
    row("awk-10000", "awk '{sum+=$2} END{print NR,sum}'", {}, "value 7\n".repeat(10_000)),
  ];
  return specimens.map(specimen => ({ id: `performance/${specimen.label}`, group: "performance", command: specimen.label,
    script: specimen.script, files: {}, stdin: Buffer.from(specimen.stdin).toString("base64"), nativeExit: 0,
    modes: false, directories: [], fileModes: {}, network: false, stderrPolicy: "exact-after-root-path-projection" }));
}
