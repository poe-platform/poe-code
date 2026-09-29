import { tsortCommands } from "../../src/commands/tsort/index.js";
import { hexdumpCommands } from "../../src/commands/hexdump/index.js";
import { odCommands } from "../../src/commands/od/index.js";
import { xxdCommands } from "../../src/commands/xxd/index.js";
import { printenvCommands } from "../../src/commands/printenv/index.js";
import { pathchkCommands } from "../../src/commands/pathchk/index.js";
import { getoptCommands } from "../../src/commands/getopt/index.js";
import { calCommands } from "../../src/commands/cal/index.js";
import { htmlToMarkdownCommands } from "../../src/commands/html-to-markdown/index.ts";
import { htmlqCommands } from "../../src/commands/htmlq/index.ts";
import { whichCommands } from "../../src/commands/which/index.ts";
import { csvkitCommands, evalSyncCsvstack, evalSyncCsvjoin } from "../../src/commands/csvkit/index.ts";
import { xmlCommands } from "../../src/commands/xml/index.ts";
import { yqCommands } from "../../src/commands/yq/index.ts";
import { ddCommands } from "../../src/commands/dd/index.ts";
import { installCommands } from "../../src/commands/install/index.ts";
import { spongeCommands } from "../../src/commands/sponge/index.ts";
import { csplitCommands } from "../../src/commands/csplit/index.ts";
import { lessCommands } from "../../src/commands/less/index.ts";
import { fileCommands } from "../../src/commands/file/index.ts";
import { archiveCommands } from "../../src/commands/archive/index.ts";
import { splitCommands } from "../../src/commands/split/index.ts";
import { prCommands } from "../../src/commands/pr/index.ts";
import { mdqCommands } from "../../src/commands/mdq/index.ts";
import { timeEnvCommands } from "../../src/commands/time-env/index.ts";
import { xanCommands } from "../../src/commands/xan/index.ts";
import { csvgrepCommands } from "../../src/commands/csvgrep/index.ts";
import { duCommands } from "../../src/commands/du/index.js";
import { diffPatchCommands } from "../../src/commands/diff-patch/index.js";
import { treeCommands } from "../../src/commands/tree/index.js";
import { fdCommands } from "../../src/commands/fd/index.js";
import { searchCommands } from "../../src/commands/search/index.js";
import { bcCommands } from "../../src/commands/bc/index.js";
import { tableTextCommands } from "../../src/commands/table-text/index.js";
import { columnCommands } from "../../src/commands/column/index.js";
import { structuredCommands } from "../../src/commands/structured/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import { exprCommands } from "../../src/commands/expr/index.js";
import { metadataCommands } from "../../src/commands/metadata/index.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/shell.js";
import { standardCommands } from "../../src/commands/index.js";
import { byteCommands } from "../../src/commands/bytes/index.js";
import { dos2unixCommands } from "../../src/commands/line-endings/index.js";
import { iconvCommands, evalSyncIconv } from "../../src/commands/iconv/index.js";

for (const [separator, flags] of [["\t", ["--tabs"]], [";", ["-d", ";"]], [";", ["--delimiter=;"]]] as const) {
  for (const command of ["csvstack", "csvjoin"] as const) {
    test(`${command} sync input dialect: ${flags.join(" ")}`, () => {
      const files = new Map([
        ["left.csv", new TextEncoder().encode(`id${separator}name\n10${separator}Alice\n`)],
        ["right.csv", new TextEncoder().encode(`id${separator}name\n20${separator}Bob\n`)]
      ]);
      const evaluate = command === "csvstack" ? evalSyncCsvstack : evalSyncCsvjoin;
      assert.equal(evaluate(undefined, [...flags, "left.csv", "right.csv"], file => files.get(file)),
        command === "csvstack" ? "id,name\n10,Alice\n20,Bob\n" : "id,name,id2,name2\n10,Alice,20,Bob\n");
    });
  }
}

for (const [command, input, expected] of [
  ["dos2unix", "hello\\r\\n", "hello\n"],
  ["unix2dos", "hello\\n", "hello\r\n"],
  ["iconv -f UTF-8 -t ASCII//IGNORE", "café\\n", "caf\n"],
] as const) {
  for (const operand of ["", " -"]) {
    for (const tail of ["", " | cat"]) {
      test(`inherited stdin: ${command}${operand}${tail}`, async () => {
        const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(byteCommands()).use(dos2unixCommands()).use(iconvCommands());
        try {
          const result = await shell.exec(`printf '${input}' | { printf '%s\\n' "$(${command}${operand}${tail})"; }`);
          assert.equal(result.exitCode, 0);
          assert.equal(result.stdout, expected);
        } finally { await shell.dispose(); }
      });
    }
  }
}

for (const source of ['iconv -f UTF-8 -t ISO-8859-1 <<< "café"', 'printf "café\\n" | iconv -f UTF-8 -t LATIN1']) {
  test(`Latin-1 substitution bytes: ${source}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(byteCommands()).use(iconvCommands());
    try {
      const result = await shell.exec(`printf '%s\\n' "$(${source})" | od -An -tx1`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), "63 61 66 e9 0a");
    } finally { await shell.dispose(); }
  });
}

test("sync iconv declines output requiring byte provenance", () => {
  for (const text of ["café", "a\0b"]) {
    assert.equal(evalSyncIconv(new TextEncoder().encode(text), ["-f", "UTF-8", "-t", "LATIN1"]), undefined);
  }
});

test("evaluates cp/mv mode preservation, ln hard/symbolic links, and stat in sync substitutions (Wave 164)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs }).use(standardCommands()).use(metadataCommands());
  const res = await shell.exec([
    "echo \"exec-payload\" > /tmp/src164.sh",
    "$(chmod 755 /tmp/src164.sh)",
    "echo \"existing\" > /tmp/exist_cp.sh",
    "$(chmod 600 /tmp/exist_cp.sh)",
    "echo \"existing\" > /tmp/exist_mv.sh",
    "$(chmod 600 /tmp/exist_mv.sh)",
    "v_cp1=$(cp -v /tmp/src164.sh /tmp/new_cp.sh)",
    "v_cp2=$(cp /tmp/src164.sh /tmp/exist_cp.sh)",
    "v_ln1=$(ln -v /tmp/new_cp.sh /tmp/hard_ln.sh)",
    "v_ln2=$(ln -sfv /tmp/new_cp.sh /tmp/sym_ln.sh)",
    "v_mv1=$(mv -v /tmp/src164.sh /tmp/exist_mv.sh)",
    "m_new=$(stat -c \"%a\" /tmp/new_cp.sh)",
    "m_ecp=$(stat -c \"%a\" /tmp/exist_cp.sh)",
    "m_emv=$(stat -c \"%a\" /tmp/exist_mv.sh)",
    "m_hln=$(stat -c \"%a:%h\" /tmp/hard_ln.sh)",
    "t_sln=$(readlink /tmp/sym_ln.sh)",
    "echo \"modes=$m_new:$m_ecp:$m_emv hln=$m_hln sln=$t_sln\"",
    "echo \"vcp=$v_cp1|vln1=$v_ln1|vln2=$v_ln2|vmv=$v_mv1\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "modes=755:600:755 hln=755:2 sln=/tmp/new_cp.sh\n" +
    "vcp='/tmp/src164.sh' -> '/tmp/new_cp.sh'|vln1='/tmp/hard_ln.sh' => '/tmp/new_cp.sh'|vln2='/tmp/sym_ln.sh' -> '/tmp/new_cp.sh'|vmv=renamed '/tmp/src164.sh' -> '/tmp/exist_mv.sh'\n"
  );
});

test("evaluates echo -n/-e/-ne and stage-0 dirname/basename/pwd/expr in sync pipelines and brace loops (Wave 165)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(byteCommands()).use(exprCommands());
  const res = await shell.exec([
    "h=$(echo -n \"hello\" | sha256sum | cut -d\" \" -f1)",
    "b=$(echo -n \"hello\" | base64)",
    "t=$(echo -ne \"alpha\\tbeta\\n\" | cut -f2)",
    "neg=$(echo \"-42\")",
    "flg=$(echo \"--flag\")",
    "d=$(dirname /usr/local/bin | tr / _)",
    "bn=$(basename /usr/local/bin.tar.gz .tar.gz | tr a-z A-Z)",
    "p=$(pwd | tr / :)",
    "ex=$(expr 6 \\* 7 | tr 4 8)",
    "acc=\"\"",
    "for i in {1..3}; do",
    "  v=$(echo -n \"item_$i\" | tr a-z A-Z)",
    "  acc=\"$acc$v:\"",
    "done",
    "echo \"$h|$b|$t|$neg|$flg|$d|$bn|$p|$ex|$acc\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824|aGVsbG8=|beta|-42|--flag|_usr_local|BIN|:tmp|82|ITEM_1:ITEM_2:ITEM_3:\n"
  );
});

test("evaluates multi-file and formatted cat (-n/-b/-s/-E/-T) and multi-file head/tail (-q/-v) in sync substitutions, pipelines, and brace loops (Wave 166)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(textProgramCommands());
  const res = await shell.exec([
    "printf \"alpha\\nbeta\\n\" > /tmp/f1.txt",
    "printf \"gamma\\ndelta\\n\" > /tmp/f2.txt",
    "c_multi=$(cat /tmp/f1.txt /tmp/f2.txt | tr '\\n' ':')",
    "c_pipe=$(printf \"one\\n\\n\\ntwo\\n\" | cat -s -b | tr \"\\t\" \":\")",
    "c_te=$(echo -e \"k\\tv\" | cat -T -E)",
    "hq=$(head -q -n 1 /tmp/f1.txt /tmp/f2.txt | tr '\\n' ',')",
    "tq=$(tail -q -n 1 /tmp/f1.txt /tmp/f2.txt | tr '\\n' ',')",
    "hv=$(head -n 1 /tmp/f1.txt /tmp/f2.txt | head -n 1)",
    "loop_out=\"\"",
    "for i in {1..2}; do",
    "  part=$(cat -E /tmp/f1.txt | head -n $i | tail -n 1)",
    "  loop_out=\"$loop_out$part|\"",
    "done",
    "echo \"$c_multi|$c_pipe|$c_te|$hq|$tq|$hv|$loop_out\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "alpha:beta:gamma:delta:|     1:one\n\n     2:two|k^Iv$|alpha,gamma,|beta,delta,|==> /tmp/f1.txt <==|alpha$|beta$|\n"
  );
});

test("evaluates multi-file and multi-flag wc, grep (-n/-l/-L/-c/-h), sort, cut, sed, and awk in sync substitutions, pipelines, and brace loops (Wave 167)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(textProgramCommands());
  const res = await shell.exec([
    "printf \"alpha\\nbeta\\n\" > /tmp/f1.txt",
    "printf \"gamma\\ndelta\\n\" > /tmp/f2.txt",
    "w_multi=$(wc -l /tmp/f1.txt /tmp/f2.txt | tail -n 1 | tr -s \" \")",
    "w_tot=$(wc --total=only -c /tmp/f1.txt /tmp/f2.txt)",
    "w_pipe=$(printf \"one two\\nthree\\n\" | wc -lw | tr -s \" \")",
    "g_l=$(grep -l \"gamma\" /tmp/f1.txt /tmp/f2.txt)",
    "g_L=$(grep -L \"gamma\" /tmp/f1.txt /tmp/f2.txt)",
    "g_c=$(grep -c \"a\" /tmp/f1.txt /tmp/f2.txt | tr '\\n' ',')",
    "g_h=$(grep -h \"alpha\" /tmp/f1.txt /tmp/f2.txt)",
    "s_m=$(sort /tmp/f2.txt /tmp/f1.txt | tr '\\n' ':')",
    "c_m=$(cut -c1-2 /tmp/f1.txt /tmp/f2.txt | tr '\\n' ':')",
    "sed_m=$(sed 's/a/A/g' /tmp/f1.txt /tmp/f2.txt | tr '\\n' ':')",
    "awk_m=$(awk '{print $1}' /tmp/f1.txt /tmp/f2.txt | tr '\\n' ':')",
    "loop_res=\"\"",
    "for i in {1..2}; do",
    "  g_n=$(grep -n \"a\" /tmp/f1.txt /tmp/f2.txt | head -n $i | tail -n 1)",
    "  loop_res=\"$loop_res$g_n|\"",
    "done",
    "echo \"$w_multi|$w_tot|$w_pipe|$g_l|$g_L|$g_c|$g_h|$s_m|$c_m|$sed_m|$awk_m|$loop_res\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    " 4 total|23| 2 3|/tmp/f2.txt|/tmp/f1.txt|/tmp/f1.txt:2,/tmp/f2.txt:2,|alpha|alpha:beta:delta:gamma:|al:be:ga:de:|AlphA:betA:gAmmA:deltA:|alpha:beta:gamma:delta:|/tmp/f1.txt:1:alpha|/tmp/f1.txt:2:beta|\n"
  );
});

test("evaluates stage-0 < file input redirections in pipelines and rev/tac/uniq file operands in sync substitutions and brace loops (Wave 168)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(textProgramCommands());
  const res = await shell.exec([
    "printf \"alpha\\nbeta\\n\" > /tmp/f1.txt",
    "printf \"gamma\\ndelta\\n\" > /tmp/f2.txt",
    "printf \"x\\nx\\ny\\n\" > /tmp/dups.txt",
    "tr_redir=$(tr 'a-z' 'A-Z' < /tmp/f1.txt | tr '\\n' ':')",
    "sort_redir=$(sort -r < /tmp/f1.txt | tr '\\n' ':')",
    "sed_redir=$(sed 's/a/A/g' < /tmp/f1.txt | head -n 1)",
    "wc_redir=$(wc -l < /tmp/f1.txt | tr -d ' ')",
    "rev_m=$(rev /tmp/f1.txt /tmp/f2.txt | tr '\\n' ':')",
    "tac_m=$(tac /tmp/f1.txt /tmp/f2.txt | tr '\\n' ':')",
    "uniq_p=$(uniq -c /tmp/dups.txt | tr -s ' ' | tr '\\n' ':')",
    "loop_out=\"\"",
    "for i in {1..2}; do",
    "  item=$(rev /tmp/f$i.txt | head -n 1)",
    "  loop_out=\"$loop_out$item|\"",
    "done",
    "echo \"$tr_redir|$sort_redir|$sed_redir|$wc_redir|$rev_m|$tac_m|$uniq_p|$loop_out\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "ALPHA:BETA:|beta:alpha:|AlphA|2|ahpla:ateb:ammag:atled:|beta:alpha:delta:gamma:| 2 x: 1 y:|ahpla|ammag|\n"
  );
});

test("evaluates jq -n/--null-input, -s/--slurp, --arg, --argjson, dynamic object keys {($k): $v}, and multi-file jq in sync substitutions, pipelines, and brace loops (Wave 169)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(structuredCommands());
  const res = await shell.exec([
    "printf '{\"id\":10,\"name\":\"alpha\"}\\n' > /tmp/j1.json",
    "printf '{\"id\":25,\"name\":\"beta\"}\\n' > /tmp/j2.json",
    "j_null=$(jq -n -c --arg k \"host\" --arg v \"localhost\" --argjson port 8080 '{($k): $v, $port}')",
    "j_sel=$(jq -r --arg target \"beta\" 'select(.name == $target) | .id' /tmp/j1.json /tmp/j2.json)",
    "j_slurp=$(jq -s -c 'map(.id) | add' /tmp/j1.json /tmp/j2.json)",
    "j_pipe=$(jq -r '.name' /tmp/j1.json /tmp/j2.json | tr '\\n' ':')",
    "loop_out=\"\"",
    "for i in {1..2}; do",
    "  item=$(jq -n -c --arg idx \"$i\" '{step: ($idx | tonumber)}' | jq -r '.step')",
    "  loop_out=\"$loop_out$item|\"",
    "done",
    "echo \"$j_null|$j_sel|$j_slurp|$j_pipe|$loop_out\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "{\"host\":\"localhost\",\"port\":8080}|25|35|alpha:beta:|1|2|\n"
  );
});

test("evaluates seq (-w, -s, -f), base64 (-w 0, -d, file operands), and column/fold/expand/unexpand/strings file operands in sync substitutions and pipelines (Wave 170)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(byteCommands()).use(columnCommands());
  const res = await shell.exec([
    "printf \"hello world\" > /tmp/msg.txt",
    "printf \"aGVsbG8gd29ybGQ=\\n\" > /tmp/msg.b64",
    "printf \"a b\\nc d\\n\" > /tmp/tbl.txt",
    "printf \"        indented\\n\" > /tmp/spaces.txt",
    "sq_w=$(seq -w 8 10 | tr '\\n' ':')",
    "sq_s=$(seq -s ',' 1 4)",
    "sq_f=$(seq -f 'item_%02g' 1 3 | tr '\\n' ':')",
    "b_enc=$(base64 -w 0 /tmp/msg.txt)",
    "b_dec=$(base64 -d /tmp/msg.b64)",
    "b_pipe=$(base64 -w 0 /tmp/msg.txt | tr 'a-z' 'A-Z')",
    "f_fold=$(fold -w 5 /tmp/msg.txt | tr '\\n' ':')",
    "u_unexp=$(unexpand -a /tmp/spaces.txt | cat -T)",
    "c_col=$(column -t /tmp/tbl.txt | tr '\\n' ':')",
    "echo \"$sq_w|$sq_s|$sq_f|$b_enc|$b_dec|$b_pipe|$f_fold|$u_unexp|$c_col\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "08:09:10:|1,2,3,4|item_01:item_02:item_03:|aGVsbG8gd29ybGQ=|hello world|AGVSBG8GD29YBGQ=|hello: worl:d|^Iindented|a  b:c  d:\n"
  );
});

test("evaluates nl, paste, comm, join, and numfmt with file operands in sync substitutions, pipelines, and brace loops (Wave 171)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(tableTextCommands());
  const res = await shell.exec([
    "printf 'x\\ny\\n' > /tmp/a.txt",
    "printf '10\\n20\\n' > /tmp/b.txt",
    "printf 'a\\nb\\nc\\n' > /tmp/s1.txt",
    "printf 'b\\nc\\nd\\n' > /tmp/s2.txt",
    "printf '1:alice\\n2:bob\\n' > /tmp/j1.txt",
    "printf '1:admin\\n2:user\\n' > /tmp/j2.txt",
    "printf '1024\\n2048\\n' > /tmp/nums.txt",
    "nl_pipe=$(nl -ba -w 2 -s : /tmp/a.txt /tmp/b.txt | tr '\\n' ',')",
    "paste_pipe=$(paste -d : /tmp/a.txt /tmp/b.txt | tr '\\n' ',')",
    "paste_single=$(paste -s -d , /tmp/a.txt /tmp/b.txt | tr '\\n' ';')",
    "comm_single=$(comm -12 /tmp/s1.txt /tmp/s2.txt | tr '\\n' ',')",
    "join_single=$(join -t : /tmp/j1.txt /tmp/j2.txt | tr '\\n' ',')",
    "numfmt_pipe=$(numfmt --to=iec 1024 2048 | tr '\\n' ',')",
    "loop_out=''",
    "for k in 1 2; do",
    "  p=$(paste -d = /tmp/a.txt /tmp/b.txt | head -n 1)",
    "  loop_out=\"${loop_out}${p};\"",
    "done",
    "echo \"$nl_pipe|$paste_pipe|$paste_single|$comm_single|$join_single|$numfmt_pipe|$loop_out\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    " 1:x, 2:y, 3:10, 4:20,|x:10,y:20,|x,y;10,20;|b,c,|1:alice:admin,2:bob:user,|1.0K,2.0K,|x=10;x=10;\n"
  );
});

test("evaluates sed backreferences (\\1..\\9, \\&, \\t) and pattern-only awk rules in sync substitutions, pipelines, and brace loops (Wave 172)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(textProgramCommands());
  const res = await shell.exec([
    "printf '# header\\nhost:10:prod\\ndb:25:stage\\napi:30:prod\\n' > /tmp/rows.txt",
    "s_ere=$(sed -E 's/([a-z]+)=([0-9]+)/\\2:\\1/g' <<< 'a=1 b=22')",
    "s_bre=$(sed 's/\\([a-z][a-z]*\\)-\\([0-9][0-9]*\\)/\\2_\\1/' <<< 'item-42')",
    "s_amp=$(sed 's/x/[\\&]/g' <<< 'x+x')",
    "a_nr=$(awk 'NR > 2' /tmp/rows.txt | tr '\\n' ',')",
    "a_cmp=$(awk -F: '$2 >= 25' /tmp/rows.txt | tr '\\n' ',')",
    "a_nocomm=$(awk '!/^#/' /tmp/rows.txt | wc -l | tr -d ' ')",
    "c_comp=$(cut -d : -f 2 --complement /tmp/rows.txt | grep -v '^#' | tr '\\n' ',')",
    "loop_out=''",
    "for k in 1 2; do",
    "  v=$(sed -E 's/([a-z]+):([0-9]+):([a-z]+)/\\3_\\1=\\2/' /tmp/rows.txt | tail -n 1)",
    "  loop_out=\"${loop_out}${v};\"",
    "done",
    "echo \"$s_ere|$s_bre|$s_amp|$a_nr|$a_cmp|$a_nocomm|$c_comp|$loop_out\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "1:a 22:b|42_item|[&]+[&]|db:25:stage,api:30:prod,|db:25:stage,api:30:prod,|3|host:prod,db:stage,api:prod,|prod_api=30;prod_api=30;\n"
  );
});

test("evaluates standalone awk BEGIN blocks (with -v vars, arithmetic, print, printf, pipelines, and brace loops) in sync substitutions (Wave 173)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(textProgramCommands());
  const res = await shell.exec([
    "a_mul=$(awk 'BEGIN { print 6 * 7 }')",
    "a_div=$(awk -v a=15 -v b=4 'BEGIN { printf \"%.2f\", a / b }')",
    "a_var=$(awk 'BEGIN { x = 10 + 5; print \"val=\" x * 2 }')",
    "a_pipe=$(awk 'BEGIN { print \"alpha:beta:gamma\" }' | cut -d : -f 2)",
    "loop_out=''",
    "for k in 1 2 3; do",
    "  r=$(awk -v n=\"$k\" 'BEGIN { printf \"%03d\", n * 10 }')",
    "  loop_out=\"${loop_out}${r},\"",
    "done",
    "echo \"$a_mul|$a_div|$a_var|$a_pipe|$loop_out\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "42|3.75|val=30|beta|010,020,030,\n"
  );
});

test("evaluates grep -f pattern files, flags after -e, and -Fo/-Ewo only-matching in sync substitutions, pipelines, and brace loops (Wave 174)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(textProgramCommands());
  const res = await shell.exec([
    "printf 'alpha\\ngamma\\n' > /tmp/pats.txt",
    "printf 'alpha_1\\nbeta_2\\ngamma_3\\nDELTA_4\\n' > /tmp/data.txt",
    "g_file=$(grep -f /tmp/pats.txt /tmp/data.txt | tr '\\n' ',')",
    "g_ff=$(grep -Ff /tmp/pats.txt /tmp/data.txt | wc -l | tr -d ' ')",
    "g_post=$(grep -e alpha -e delta -i /tmp/data.txt | tr '\\n' ',')",
    "g_fo=$(grep -Fo 'a.b' <<< 'a.b axb a.b' | tr '\\n' ',')",
    "g_wo=$(grep -Ewo '[a-z]{3}' <<< 'cat cats dog dogs' | tr '\\n' ',')",
    "loop_out=''",
    "for k in 1 2; do",
    "  m=$(grep -f /tmp/pats.txt /tmp/data.txt | tail -n 1)",
    "  loop_out=\"${loop_out}${m};\"",
    "done",
    "echo \"$g_file|$g_ff|$g_post|$g_fo|$g_wo|$loop_out\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "alpha_1,gamma_3,|2|alpha_1,DELTA_4,|a.b,a.b,|cat,dog,|gamma_3;gamma_3;\n"
  );
});

test("evaluates multi-key sort (-k 2,2n -k 1,1r) and sed a/i/c line operations in sync substitutions, pipelines, and brace loops (Wave 175)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(textProgramCommands());
  const res = await shell.exec([
    "printf 'b:10\\na:20\\nc:10\\nd:5\\n' > /tmp/items.txt",
    "s_multi=$(sort -t : -k 2,2n -k 1,1r /tmp/items.txt | tr '\\n' ',')",
    "s_uniq=$(sort -u -t : -k 2,2n /tmp/items.txt | tr '\\n' ',')",
    "sed_i=$(sed '1i HDR:0' /tmp/items.txt | head -n 2 | tr '\\n' ',')",
    "sed_a=$(sed '$a END:99' /tmp/items.txt | tail -n 2 | tr '\\n' ',')",
    "sed_c=$(sed '/^a:/c a:999' /tmp/items.txt | tr '\\n' ',')",
    "loop_out=''",
    "for k in 1 2; do",
    "  top=$(sort -t : -k 2,2n -k 1,1r /tmp/items.txt | sed -n '2p')",
    "  loop_out=\"${loop_out}${top};\"",
    "done",
    "echo \"$s_multi|$s_uniq|$sed_i|$sed_a|$sed_c|$loop_out\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "d:5,c:10,b:10,a:20,|d:5,b:10,a:20,|HDR:0,b:10,|d:5,END:99,|b:10,a:999,c:10,d:5,|c:10;c:10;\n"
  );
});

test("evaluates tr long flags (--delete, --squeeze-repeats), [c*] repeat sets, and uniq -D/--all-repeated in sync substitutions and pipelines (Wave 176)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands());
  const res = await shell.exec([
    "printf 'a\\na\\nb\\nc\\nc\\n' > /tmp/dups.txt",
    "t_del=$(tr --delete '[:punct:]' <<< 'a,b:c!d')",
    "t_sq=$(tr --squeeze-repeats '[:blank:]' ' ' <<< $'x\t\ty   z')",
    "t_rep=$(tr '0-9' '[#*]' <<< 'id=42')",
    "u_all=$(uniq -D /tmp/dups.txt | tr '\\n' ',')",
    "u_sep=$(uniq --all-repeated=separate /tmp/dups.txt | tr '\\n' ',')",
    "echo \"$t_del|$t_sq|$t_rep|$u_all|$u_sep\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "abcd|x y z|id=##|a,a,c,c,|a,a,,c,c,\n"
  );
});

test("evaluates jq @tsv, @csv, @base64, @base64d, @uri, @sh, with_entries, and inline [...] array stages in sync substitutions and pipelines (Wave 177)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(structuredCommands());
  const res = await shell.exec([
    "printf '{\"items\":[{\"id\":1,\"name\":\"alice\"},{\"id\":2,\"name\":\"bob\"}],\"q\":\"a b&c\",\"msg\":\"hello\",\"cmd\":[\"echo\",\"hi there\"],\"meta\":{\"a\":10,\"b\":null,\"c\":20}}\n' > /tmp/doc.json",
    "j_tsv=$(jq -r '.items[] | [.id, .name] | @tsv' /tmp/doc.json | tr '\\t\\n' ':,')",
    "j_csv=$(jq -r '.items[] | [.id, .name] | @csv' /tmp/doc.json | tr '\\n' ';')",
    "j_b64=$(jq -r '.msg | @base64' /tmp/doc.json)",
    "j_b64d=$(jq -r '.msg | @base64 | @base64d' /tmp/doc.json)",
    "j_uri=$(jq -r '.q | @uri' /tmp/doc.json)",
    "j_sh=$(jq -r '.cmd | @sh' /tmp/doc.json)",
    "j_we=$(jq -c '.meta | with_entries(select(.value != null))' /tmp/doc.json)",
    "echo \"$j_tsv|$j_csv|$j_b64|$j_b64d|$j_uri|$j_sh|$j_we\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "1:alice,2:bob,|1,\"alice\";2,\"bob\";|aGVsbG8=|hello|a%20b%26c|'echo' 'hi there'|{\"a\":10,\"c\":20}\n"
  );
});

test("evaluates jq boolean and/or operators and if-then-elif-else-end conditionals in sync substitutions, pipelines, and brace loops (Wave 178)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(structuredCommands());
  const res = await shell.exec([
    "printf '[{\"name\":\"alice\",\"role\":\"admin\",\"score\":95},{\"name\":\"bob\",\"role\":\"user\",\"score\":82},{\"name\":\"carol\",\"role\":\"admin\",\"score\":70}]\n' > /tmp/users.json",
    "j_and=$(jq -r '.[] | select(.role == \"admin\" and .score >= 90) | .name' /tmp/users.json)",
    "j_or=$(jq -r '.[] | select(.name == \"bob\" or .score < 75) | .name' /tmp/users.json | tr '\\n' ',')",
    "j_if=$(jq -r '.[] | (.name + \":\" + (if .score >= 90 then \"A\" elif .score >= 80 then \"B\" else \"C\" end))' /tmp/users.json | tr '\\n' ',')",
    "loop_out=''",
    "for k in 90 80; do",
    "  c=$(jq --argjson min \"$k\" -r '[.[] | select(.score >= $min and .role != \"guest\") | .name] | join(\":\")' /tmp/users.json)",
    "  loop_out=\"${loop_out}${c};\"",
    "done",
    "echo \"$j_and|$j_or|$j_if|$loop_out\""
  ].join("\n"));
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "alice|bob,carol,|alice:A,bob:B,carol:C,|alice;alice:bob;\n"
  );
});

test("evaluates jq range, sub/gsub, scan, escaped test(), predicate any(expr)/all(expr), paths/leaf_paths, and getpath in sync substitutions and pipelines (Wave 179)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(structuredCommands());
  const r = await shell.exec("j_rng=$(jq -cn '[range(1; 8; 2)]')\nj_sub=$(echo '\"foo_123_bar_456\"' | jq -r 'sub(\"_[0-9]+\"; \"-NUM\") | gsub(\"_\"; \":\")')\nj_scan=$(echo '\"v1.2 and v3.45\"' | jq -c '[scan(\"v[0-9]+\\\\.[0-9]+\")]')\nj_test=$(echo '\"release-2026\"' | jq 'test(\"^release-[0-9]{4}$\")')\nj_any=$(echo '[2, 5, 12, 3]' | jq 'any(. > 10), all(. > 0)' | tr '\\n' ',')\nj_paths=$(echo '{\"a\":{\"b\":1},\"c\":[2,3]}' | jq -c '[leaf_paths]')\nj_getp=$(echo '{\"a\":{\"b\":42}}' | jq 'getpath([\"a\",\"b\"])')\nprintf \"%s|%s|%s|%s|%s|%s|%s\\n\" \"$j_rng\" \"$j_sub\" \"$j_scan\" \"$j_test\" \"$j_any\" \"$j_paths\" \"$j_getp\"");
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "[1,3,5,7]|foo-NUM:bar:456|[\"v1.2\",\"v3.45\"]|true|true,true,|[[\"a\",\"b\"],[\"c\",0],[\"c\",1]]|42\n",
  );
});
test("evaluates awk printf formatting (%s/%-Ns/%d/%0Nd), n = split(...) count and elements, and character-class regexes in sub/gsub in sync substitutions and brace loops (Wave 180)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(textProgramCommands());
  const r = await shell.exec("printf \"alice 7 a-b-c\\nbob 42 x-y\\n\" > /tmp/awk_in.txt\na_printf=$(awk '{ printf \"%-6s:%04d\\n\", $1, $2 }' /tmp/awk_in.txt | tr '\\n' '|')\na_split=$(awk '{ n = split($3, parts, \"-\"); print $1, n, parts[1], parts[2] }' /tmp/awk_in.txt | tr '\\n' '|')\na_gsub=$(printf \"item_12_cost_340\\n\" | awk '{ gsub(/[0-9]+/, \"N\"); print $0 }')\nloop_res=\"\"\nfor k in 1 2; do\n  v=$(awk -v mult=\"$k\" '{ printf \"%s=%03d;\", $1, $2 * mult }' /tmp/awk_in.txt)\n  loop_res=\"${loop_res}${v}\"\ndone\nprintf \"%s#%s#%s#%s\\n\" \"$a_printf\" \"$a_split\" \"$a_gsub\" \"$loop_res\"");
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "alice :0007|bob   :0042|#alice 3 a b|bob 2 x y|#item_N_cost_N#alice=007;bob=042;alice=014;bob=084;\n",
  );
});
test("evaluates sed semicolons inside s///, escaped delimiters (\\/), step addresses (1~2p), and regex range addresses (/START/,/END/) in sync substitutions and brace loops (Wave 181)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(textProgramCommands());
  const r = await shell.exec("printf \"hdr\\nSTART\\nkeep1\\nEND\\nmid\\nSTART\\nkeep2\\nEND\\ntail\\n\" > /tmp/sed_in.txt\ns_semi=$(printf \"a;b;c\\n\" | sed 's/;/,/g; s/b/B/')\ns_esc=$(printf \"/usr/local/bin\\n\" | sed 's/\\/usr\\/local/\\/opt/g')\ns_step=$(printf \"1\\n2\\n3\\n4\\n5\\n\" | sed -n '1~2p' | tr '\\n' ',')\ns_range=$(sed -n '/^START$/,/^END$/p' /tmp/sed_in.txt | tr '\\n' ',')\ns_del=$(sed '/^START$/,/^END$/d' /tmp/sed_in.txt | tr '\\n' ',')\nloop_out=\"\"\nfor k in 1 2; do\n  v=$(sed -n \"${k}~2p\" /tmp/sed_in.txt | tr '\\n' ':')\n  loop_out=\"${loop_out}${v}|\"\ndone\nprintf \"%s#%s#%s#%s#%s#%s\\n\" \"$s_semi\" \"$s_esc\" \"$s_step\" \"$s_range\" \"$s_del\" \"$loop_out\"");
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "a,B,c#/opt/bin#1,3,5,#START,keep1,END,START,keep2,END,#hdr,mid,tail,#hdr:keep1:mid:keep2:tail:|START:END:START:END:|\n",
  );
});
test("evaluates grep BRE regexes (\\+, \\{n,m\\}, \\.), ERE {n,m} quantifiers, grep -o BRE/ERE patterns, and -H/-h/-q in sync substitutions and brace loops (Wave 182)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands());
  const r = await shell.exec("printf \"rel-2026.01\\nrel-2025.12\\ndev-99\\ntag-2026.05\\n\" > /tmp/grep_in.txt\ng_bre=$(grep '^rel-[0-9]\\+\\.[0-9]\\{2\\}$' /tmp/grep_in.txt | tr '\\n' ',')\ng_ere=$(grep -E '^(rel|tag)-[0-9]{4}\\.[0-9]{2}$' /tmp/grep_in.txt | tr '\\n' ',')\ng_eo=$(grep -Eo '[0-9]{4}\\.[0-9]{2}' /tmp/grep_in.txt | tr '\\n' ',')\ng_bre_o=$(grep -o '[0-9]\\{4\\}' /tmp/grep_in.txt | tr '\\n' ',')\ng_hn=$(cat /tmp/grep_in.txt | grep -Hn '^dev-[0-9]\\+' | tr '\\n' ',')\nloop_out=\"\"\nfor yr in 2025 2026; do\n  c=$(grep -c \"^[a-z]\\{3\\}-${yr}\\.[0-9]\\{2\\}$\" /tmp/grep_in.txt)\n  loop_out=\"${loop_out}${yr}:${c};\"\ndone\nprintf \"%s#%s#%s#%s#%s#%s\\n\" \"$g_bre\" \"$g_ere\" \"$g_eo\" \"$g_bre_o\" \"$g_hn\" \"$loop_out\"");
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "rel-2026.01,rel-2025.12,#rel-2026.01,rel-2025.12,tag-2026.05,#2026.01,2025.12,2026.05,#2026,2025,2026,#(standard input):3:dev-99,#2025:1;2026:2;\n",
  );
});
test("evaluates sort --key=, combined -rnk/-nt:, start-field modifiers (-k 2n,2), character offsets (-k 1.4,1.5n), cut -c --output-delimiter and -sf, and uniq --group in sync substitutions (Wave 183)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands());
  const r = await shell.exec("printf \"id_03:40\\nid_01:100\\nid_02:20\\n\" > /tmp/sort_in.txt\ns_key=$(sort -t: --key=2n,2 /tmp/sort_in.txt | tr '\\n' ',')\ns_comb=$(sort -nt: -rnk2,2 /tmp/sort_in.txt | tr '\\n' ',')\ns_char=$(sort -t: -k 1.4,1.5n /tmp/sort_in.txt | tr '\\n' ',')\nc_delim=$(printf \"abcdef\\n123456\\n\" | cut -c 1-2,5-6 --output-delimiter=: | tr '\\n' ',')\nc_sf=$(printf \"no_delim\\na:b:c\\n\" | cut -d: -sf2)\nu_grp=$(printf \"a\\na\\nb\\nc\\nc\\n\" | uniq --group=separate | tr '\\n' ':')\nprintf \"%s#%s#%s#%s#%s#%s\\n\" \"$s_key\" \"$s_comb\" \"$s_char\" \"$c_delim\" \"$c_sf\" \"$u_grp\"");
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "id_02:20,id_03:40,id_01:100,#id_01:100,id_03:40,id_02:20,#id_01:100,id_02:20,id_03:40,#ab:ef,12:56,#b#a:a::b::c:c:\n",
  );
});
test("evaluates join -i/--header/attached flags (-a1/-e0/-o...), comm --nocheck-order/--output-delimiter, and column -t with tabs and -ts: in sync substitutions (Wave 184)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(tableTextCommands()).use(columnCommands());
  const r = await shell.exec("printf \"ID:Name\\na1:Alice\\nb2:Bob\\n\" > /tmp/j1.txt\nprintf \"ID:Score\\nA1:95\\nc3:80\\n\" > /tmp/j2.txt\nj_hdr=$(join -t: -i --header -a1 -e0 -o0,1.2,2.2 /tmp/j1.txt /tmp/j2.txt | tr '\\n' ',')\nc_del=$(comm --nocheck-order --output-delimiter : -3 /tmp/j1.txt /tmp/j2.txt | tr '\\n' ',')\ncol_tsv=$(printf \"name\\tscore\\nalice\\t95\\nbob\\t100\\n\" | column -t | tr '\\n' ',')\ncol_ts=$(column -ts: /tmp/j1.txt | tr '\\n' ',')\nprintf \"%s#%s#%s#%s\\n\" \"$j_hdr\" \"$c_del\" \"$col_tsv\" \"$col_ts\"");
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "ID:Name:Score,a1:Alice:95,b2:Bob:0,#ID:Name,:ID:Score,:A1:95,a1:Alice,b2:Bob,:c3:80,#name   score,alice  95,bob    100,#ID  Name,a1  Alice,b2  Bob,\n",
  );
});
test("evaluates expr STRING : REGEXP / match capture groups and |/&, and bc relational comparisons, ^ exponentiation, and ibase/obase in sync substitutions (Wave 185)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(exprCommands()).use(bcCommands());
  const r = await shell.exec("e_len=$(expr \"release_2026\" : '[a-z]*')\ne_cap=$(expr \"v2.14.8\" : 'v\\([0-9.]*\\)')\ne_match=$(expr match \"item_42\" 'item_\\([0-9]*\\)')\ne_or=$(expr \"\" \\| \"fallback\")\nb_cmp=$(echo \"3.1415 > 2.7182; 1.5 == 1.50\" | bc | tr '\\n' ',')\nb_pow=$(echo \"2 ^ 10\" | bc)\nb_hex=$(echo \"obase=16; 255\" | bc)\nb_from_hex=$(echo \"ibase=16; FF\" | bc)\nprintf \"%s#%s#%s#%s#%s#%s#%s#%s\\n\" \"$e_len\" \"$e_cap\" \"$e_match\" \"$e_or\" \"$b_cmp\" \"$b_pow\" \"$b_hex\" \"$b_from_hex\"");
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "7#2.14.8#42#fallback#1,1,#1024#FF#255\n",
  );
});

test("evaluates numfmt --header/-d/--field/--from-unit/--to-unit, xxd -l/-s, and od -j/-N in sync substitutions (Wave 186)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(byteCommands());
  const r = await shell.exec(
    [
      "nf_tbl=$(printf \"NAME:SIZE\\nfileA:2048\\nfileB:1048576\\n\" | numfmt --header -d: --field=2 --to=iec | tr '\\n' ',')",
      "nf_unit=$(echo 4 | numfmt --from-unit=512 --to=iec)",
      "xxd_sub=$(printf \"abcdef\" | xxd -p -s 2 -l 3)",
      "od_sub=$(printf \"ABCDEF\" | od -An -tx1 -j 1 -N 3)",
      "printf \"%s#%s#%s#%s\\n\" \"$nf_tbl\" \"$nf_unit\" \"$xxd_sub\" \"$od_sub\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "NAME:SIZE,fileA:2.0K,fileB:1.0M,#2.0K#636465# 42 43 44\n",
  );
});

test("evaluates nl -h/-f/-p/-l, strings -t d/o/x, and expand/unexpand comma-separated tab-stop lists (-t 4,8,12) in sync substitutions (Wave 187)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands());
  const r = await shell.exec(
    [
      "nl_sec=$(printf \"\\:\\:\\:\\nhdr\\n\\:\\:\\nbody1\\n\\n\\nbody2\\n\" | nl -h a -b a -l 2 -p -w 2 -s : | tr '\\n' ',')",
      "str_hex=$(printf \"x\\nhello\\ny\\nworld\\n\" | strings -t x -n 4 | tr '\\n' ',')",
      "exp_lst=$(printf \"a\\tb\\tc\\n\" | expand -t 4,8)",
      "unexp_lst=$(printf \"a   b   c\\n\" | unexpand -t 4,8)",
      "printf \"%s#%s#%s#%s\\n\" \"$nl_sec\" \"$str_hex\" \"$exp_lst\" \"$unexp_lst\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    ", 1:hdr,, 2:body1,   , 3:, 4:body2,#      2 hello,      a world,#a   b   c#a\tb\tc\n",
  );
});

test("evaluates seq decimal stepping (0 0.5 2) and %.Nf formatting, base64 -d -i / -di ignore-garbage, and tr [=c=] equivalence classes in sync substitutions (Wave 188)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(byteCommands());
  const r = await shell.exec(
    [
      "sq_dec=$(seq -s : 0 0.5 2)",
      "sq_fmt=$(seq -s , -f \"%05.2f\" 1 0.5 2)",
      "b64_ig=$(printf \"aGVs***bG8=\\n\" | base64 -di)",
      "tr_eq=$(printf \"banana\" | tr '[=a=]' 'o')",
      "printf \"%s#%s#%s#%s\\n\" \"$sq_dec\" \"$sq_fmt\" \"$b64_ig\" \"$tr_eq\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "0.0:0.5:1.0:1.5:2.0#01.00,01.50,02.00#hello#bonono\n",
  );
});

test("evaluates find -regex/-iregex/-printf/-quit and xargs printf/basename/dirname/-0 in sync substitutions and pipelines (Wave 189)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands());
  const r = await shell.exec(
    [
      "mkdir -p /tmp/w189/sub && printf \"hello\" > /tmp/w189/sub/alpha.txt && printf \"world!\" > /tmp/w189/sub/beta.md",
      "f_printf=$(find /tmp/w189 -type f -printf \"%f:%s:%y,\")",
      "f_regex=$(find /tmp/w189 -regex \".*\\.txt\")",
      "x_printf=$(printf \"one\\ntwo\\nthree\\n\" | xargs printf \"[%s]\")",
      "x_base=$(printf \"/a/b/foo.txt\\n/c/d/bar.txt\\n\" | xargs basename -s .txt | tr '\\n' ',')",
      "x_dir=$(printf \"/a/b/foo.txt\\n/c/d/bar.txt\\n\" | xargs -n 1 dirname | tr '\\n' ',')",
      "printf \"%s#%s#%s#%s#%s\\n\" \"$f_printf\" \"$f_regex\" \"$x_printf\" \"$x_base\" \"$x_dir\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "alpha.txt:5:f,beta.md:6:f,#/tmp/w189/sub/alpha.txt#[one][two][three]#foo,bar,#/a/b,/c/d,\n",
  );
});

test("evaluates rg -o/-w/-x/-r replacement/multiple -e and fd -E exclude/-S size/--and/--path-separator in sync substitutions (Wave 190)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(fdCommands()).use(searchCommands());
  const r = await shell.exec(
    [
      "mkdir -p /tmp/w190/keep /tmp/w190/skip && printf \"12345678\" > /tmp/w190/keep/app.ts && printf \"12\" > /tmp/w190/keep/tiny.ts && printf \"12345678\" > /tmp/w190/skip/ignored.ts",
      "fd_res=$(fd -E skip -S +5b --and app --path-separator :: . /tmp/w190)",
      "rg_rep=$(printf \"id=42 name=alice\\nid=99 name=bob\\n\" | rg -o 'id=(\\d+) name=(\\w+)' -r '$2:$1' | tr '\\n' ',')",
      "rg_multi=$(printf \"apple\\nbanana\\ncherry\\n\" | rg -w -e apple -e cherry | tr '\\n' ',')",
      "printf \"%s#%s#%s\\n\" \"$fd_res\" \"$rg_rep\" \"$rg_multi\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "::tmp::w190::keep::app.ts#alice:42,bob:99,#apple,cherry,\n",
  );
});

test("evaluates ls --group-directories-first/-X/-B/-I/-m/-R and tree --dirsfirst/-P/-I/-F in sync substitutions (Wave 191)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(treeCommands());
  const r = await shell.exec(
    [
      "mkdir -p /tmp/w191/zdir && printf \"a\" > /tmp/w191/file.b && printf \"b\" > /tmp/w191/file.a && printf \"bak\" > /tmp/w191/file.a~ && printf \"skip\" > /tmp/w191/ignore.me",
      "ls_df=$(ls --group-directories-first -B -I '*.me' -X -m /tmp/w191)",
      "tr_df=$(tree --dirsfirst --noreport -I '*.me|*'~ -P '*.a' -F /tmp/w191 | tr '\\n' ',')",
      "printf \"%s#%s\\n\" \"$ls_df\" \"$tr_df\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "zdir, file.a, file.b#/tmp/w191/,├── zdir/,└── file.a,\n",
  );
});

test("evaluates du --exclude/--threshold/-t, diff -I/--from-file/--to-file, and cmp -iSKIP/-nLIMIT in sync substitutions (Wave 192)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(byteCommands()).use(duCommands()).use(diffPatchCommands());
  const r = await shell.exec(
    [
      "mkdir -p /tmp/w192 && printf \"1234567890\" > /tmp/w192/big.txt && printf \"12\" > /tmp/w192/small.txt && printf \"1234567890\" > /tmp/w192/skip.bak",
      "du_res=$(du -a -b --exclude='*.bak' --threshold=5 /tmp/w192 | tr '\\t\\n' ':,')",
      "printf \"hdr_v1\\nsame\\n\" > /tmp/w192/d1.txt && printf \"hdr_v2\\nsame\\n\" > /tmp/w192/d2.txt",
      "df_res=$(diff -s -I '^hdr_' --from-file=/tmp/w192/d1.txt /tmp/w192/d2.txt)",
      "cmp_res=$(cmp -s -i7 -n4 /tmp/w192/d1.txt /tmp/w192/d2.txt && echo ok)",
      "printf \"%s#%s#%s\\n\" \"$du_res\" \"$df_res\" \"$cmp_res\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "10:/tmp/w192/big.txt,12:/tmp/w192,#Files /tmp/w192/d1.txt and /tmp/w192/d2.txt are identical#ok\n",
  );
});

test("evaluates xan range/wildcard/negated column selectors and csvgrep -f pattern file in sync substitutions (Wave 193)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(xanCommands()).use(csvgrepCommands());
  const r = await shell.exec(
    [
      "printf \"id,user_name,user_role,score\\n1,alice,admin,99\\n2,bob,user,80\\n3,carol,admin,95\\n\" > /tmp/w193.csv",
      "printf \"admin\\n\" > /tmp/w193.pats",
      "xan_sel=$(xan select \"!id,user_role,score\" /tmp/w193.csv | tr \"\\n\" \",\")",
      "xan_rng=$(xan select \"0:1\" /tmp/w193.csv | tr \"\\n\" \",\")",
      "cg_res=$(csvgrep -c user_role -f /tmp/w193.pats /tmp/w193.csv | xan select \"user_name,score\" | tr \"\\n\" \",\")",
      "printf \"%s#%s#%s\\n\" \"$xan_sel\" \"$xan_rng\" \"$cg_res\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "user_name,alice,bob,carol,#id,user_name,1,alice,2,bob,3,carol,#user_name,score,alice,99,carol,95,\n",
  );
});

test("evaluates shuf -z/bundled flags, mdq ordered list selector 1./-o<format>/multi-file, and date -r/-f in sync substitutions (Wave 194)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(mdqCommands()).use(timeEnvCommands());
  const r = await shell.exec(
    [
      "shuf_res=$(shuf -ze -n 2 alpha beta | tr \"\\0\" \",\" | tr -d \"\\n\")",
      "printf \"1. first step\\n2. second step\\n\" > /tmp/w194a.md",
      "printf \"1. third step\\n\" > /tmp/w194b.md",
      "mdq_res=$(mdq -oplain \"1. step\" /tmp/w194a.md /tmp/w194b.md | tr \"\\n\" \",\")",
      "printf \"2025-01-01T00:00:00Z\\n2026-06-15T00:00:00Z\\n\" > /tmp/w194.dates",
      "dt_file=$(date -u -f /tmp/w194.dates +%Y | tr \"\\n\" \",\")",
      "touch -d 2024-03-04T00:00:00Z /tmp/w194.ref",
      "dt_ref=$(date -u -r /tmp/w194.ref +%Y-%m-%d)",
      "printf \"%s#%s#%s\n\" \"$mdq_res\" \"$dt_file\" \"$dt_ref\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "first step,second step,third step,#2025,2026,#2024-03-04\n",
  );
});

test("evaluates fmt file operands, pr page headers with --date-format, and xan slice -L/--last and -I/--indices in sync substitutions (Wave 195)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(prCommands()).use(xanCommands());
  const r = await shell.exec(
    [
      "printf \"one two three four\\n\" > /tmp/w195a.txt",
      "printf \"five six seven\\n\" > /tmp/w195b.txt",
      "fmt_res=$(fmt -w 10 /tmp/w195a.txt /tmp/w195b.txt | tr \"\\n\" \",\")",
      "pr_res=$(printf \"body\\n\" | pr --date-format=\"2026-01-01\" -h \"CustomTitle\" -l 12 | grep \"CustomTitle\" | tr -s \" \")",
      "printf \"id,val\\n1,a\\n2,b\\n3,c\\n4,d\\n\" > /tmp/w195.csv",
      "xan_last=$(xan slice -L 2 /tmp/w195.csv | tr \"\\n\" \",\")",
      "xan_idx=$(xan slice -I 0,2 /tmp/w195.csv | tr \"\\n\" \",\")",
      "printf \"%s#%s#%s#%s\\n\" \"$fmt_res\" \"$pr_res\" \"$xan_last\" \"$xan_idx\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "one two,three four,five,six seven,#2026-01-01 CustomTitle Page 1#id,val,3,c,4,d,#id,val,1,a,3,c,\n",
  );
});

test("evaluates tar --exclude/--wildcards/--strip-components, unzip wildcards/-x, and split -C/-n file splitting in sync substitutions (Wave 196)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(archiveCommands()).use(splitCommands());
  const r = await shell.exec(
    [
      "mkdir -p /tmp/w196/sub && printf \"keep\\n\" > /tmp/w196/sub/a.txt && printf \"skip\\n\" > /tmp/w196/sub/b.bak",
      "tar -cf /tmp/w196.tar -C /tmp w196",
      "tar_res=$(tar -tf /tmp/w196.tar --exclude=\"*.bak\" --strip-components=2 --wildcards \"*.txt\")",
      "zip -qr /tmp/w196.zip /tmp/w196",
      "uz_res=$(unzip -Z1 /tmp/w196.zip \"*.txt\" -x \"*.bak\")",
      "printf \"abcd\\nefgh\\nijkl\\n\" > /tmp/w196.in",
      "sp_res=$(split --verbose -C 6 /tmp/w196.in /tmp/w196_part_ | tr \"\\n\" \",\")",
      "p1=$(cat /tmp/w196_part_aa)",
      "printf \"%s#%s#%s#%s\\n\" \"$tar_res\" \"$uz_res\" \"$sp_res\" \"$p1\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "a.txt#tmp/w196/sub/a.txt#creating file '/tmp/w196_part_aa',creating file '/tmp/w196_part_ab',creating file '/tmp/w196_part_ac',#abcd\n",
  );
});

test("evaluates csplit -b/regex patterns, less -p/-i/-n, and file -0/-f in sync substitutions (Wave 197)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(csplitCommands()).use(lessCommands()).use(fileCommands());
  const r = await shell.exec(
    [
      "printf \"head\\n---\\nbody\\n\" > /tmp/w197.in",
      "cs_res=$(csplit -f /tmp/w197_ -b \"%02d.txt\" /tmp/w197.in \"/^---$/\" | tr \"\\n\" \",\")",
      "cs_p1=$(cat /tmp/w197_01.txt | tr \"\\n\" \":\")",
      "printf \"line one\\nTARGET TWO\\nline three\\n\" > /tmp/w197.less",
      "less_res=$(less -N -n -i -p \"target\" /tmp/w197.less | tr \"\\n\" \",\")",
      "printf \"/tmp/w197.in\\n\" > /tmp/w197.list",
      "file_res=$(file -b --mime-type -f /tmp/w197.list)",
      "printf \"%s#%s#%s#%s\\n\" \"$cs_res\" \"$cs_p1\" \"$less_res\" \"$file_res\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "5,9,#---:body:#TARGET TWO,line three,#text/plain\n",
  );
});

test("evaluates dd of=/seek=/iflag=/oflag=/conv=notrunc, install -D/-t/-b, and sponge --append/- in sync substitutions (Wave 198)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(ddCommands()).use(installCommands()).use(spongeCommands());
  const r = await shell.exec(
    [
      "printf \"0123456789\" > /tmp/w198.in",
      "printf \"__________\" > /tmp/w198.dd",
      "dd_empty=$(dd if=/tmp/w198.in of=/tmp/w198.dd bs=2 skip=3 count=4 iflag=skip_bytes,count_bytes seek=2 oflag=seek_bytes conv=notrunc,ucase status=none)",
      "dd_res=$(cat /tmp/w198.dd)",
      "inst_res=$(install -Dv -m 644 /tmp/w198.in /tmp/w198_dir/sub/out.txt | tr \"\\n\" \",\")",
      "sp_app=$(printf \"tail\" | sponge --append /tmp/w198_dir/sub/out.txt)\n      sp_res=$(printf \"pass\" | sponge -)",
      "inst_cat=$(cat /tmp/w198_dir/sub/out.txt)",
      "printf \"%s#%s#%s#%s\\n\" \"$dd_res\" \"$inst_res\" \"$sp_res\" \"$inst_cat\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "__3456____#install: creating directory '/tmp/w198_dir',install: creating directory '/tmp/w198_dir/sub','/tmp/w198.in' -> '/tmp/w198_dir/sub/out.txt',#pass#0123456789tail\n",
  );
});

test("evaluates cp/mv -t/--target-directory/-n and multi-source, mkdir -pv, and rmdir -pv in sync substitutions (Wave 199)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands());
  const r = await shell.exec(
    [
      "mk_res=$(mkdir -pv /tmp/w199/sub | tr \"\\n\" \",\")",
      "printf \"a\" > /tmp/w199_1.txt && printf \"b\" > /tmp/w199_2.txt",
      "cp_res=$(cp -v -t /tmp/w199/sub /tmp/w199_1.txt /tmp/w199_2.txt | tr \"\\n\" \",\")",
      "mkdir -p /tmp/w199_dst",
      "mv_res=$(mv -v -t /tmp/w199_dst /tmp/w199_1.txt /tmp/w199_2.txt | tr \"\\n\" \",\")",
      "mkdir -p /tmp/w199_rm/inner",
      "rmd_res=$(rmdir -pv --ignore-fail-on-non-empty /tmp/w199_rm/inner | tr \"\\n\" \",\")",
      "printf \"%s#%s#%s#%s\\n\" \"$mk_res\" \"$cp_res\" \"$mv_res\" \"$rmd_res\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "mkdir: created directory '/tmp/w199',mkdir: created directory '/tmp/w199/sub',#'/tmp/w199_1.txt' -> '/tmp/w199/sub/w199_1.txt','/tmp/w199_2.txt' -> '/tmp/w199/sub/w199_2.txt',#renamed '/tmp/w199_1.txt' -> '/tmp/w199_dst/w199_1.txt',renamed '/tmp/w199_2.txt' -> '/tmp/w199_dst/w199_2.txt',#rmdir: removing directory, '/tmp/w199_rm/inner',rmdir: removing directory, '/tmp/w199_rm',\n",
  );
});

test("evaluates head/tail -z/bundled flags, ln -t/multi-source, and wc --files0-from in sync substitutions (Wave 200)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands());
  const r = await shell.exec(
    [
      "ht_res=$(printf \"r1\\0r2\\0r3\\0\" | head -zn2 | tail -zn1 | tr -d \"\\0\")",
      "mkdir -p /tmp/w200_ln && printf \"one\\n\" > /tmp/w200_a.txt && printf \"two\\nthree\\n\" > /tmp/w200_b.txt",
      "ln_res=$(ln -sv -t /tmp/w200_ln /tmp/w200_a.txt /tmp/w200_b.txt | tr \"\\n\" \",\")",
      "wc_res=$(printf \"/tmp/w200_a.txt\\0/tmp/w200_b.txt\\0\" | wc -l --total=only --files0-from=-)",
      "printf \"%s#%s#%s\\n\" \"$ht_res\" \"$ln_res\" \"$wc_res\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "r2#'/tmp/w200_ln/w200_a.txt' -> '/tmp/w200_a.txt','/tmp/w200_ln/w200_b.txt' -> '/tmp/w200_b.txt',#3\n",
  );
});

test("evaluates chmod -v/-c/--reference, touch -d/-t/-r, and truncate -o in sync substitutions (Wave 201)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(metadataCommands());
  const r = await shell.exec(
    [
      "printf \"hello\" > /tmp/w201_a.txt && printf \"world\" > /tmp/w201_b.txt",
      "ch1=$(chmod -c 750 /tmp/w201_a.txt)",
      "ch2=$(chmod -v --reference=/tmp/w201_a.txt /tmp/w201_b.txt)",
      "t0=$(touch -d \"2025-01-02T03:04:05Z\" /tmp/w201_a.txt)",
      "t1=$(touch -r /tmp/w201_a.txt /tmp/w201_b.txt)",
      "t_res=$(stat -c \"%Y\" /tmp/w201_b.txt)",
      "tr0=$(truncate -o -s 2 /tmp/w201_c.txt)",
      "tr_res=$(stat -c \"%s\" /tmp/w201_c.txt)",
      "printf \"%s|%s#%s#%s\\n\" \"$ch1\" \"$ch2\" \"$t_res\" \"$tr_res\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "mode of '/tmp/w201_a.txt' changed from 0644 (rw-r--r--) to 0750 (rwxr-x---)|mode of '/tmp/w201_b.txt' changed from 0644 (rw-r--r--) to 0750 (rwxr-x---)#1735787045#8192\n",
  );
});

test("evaluates xmllint --format/--c14n, xq --arg/-n, and yq -n/--arg/object-array YAML output in sync substitutions (Wave 202)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(xmlCommands()).use(yqCommands());
  const r = await shell.exec(
    [
      "xm_fmt=$(printf \"<root><a>1</a></root>\" | xmllint --format - | tr \"\\n\" \"|\")",
      "xm_c14n=$(printf \"<root b=\\\"2\\\" a=\\\"1\\\"/>\" | xmllint --c14n -)",
      "xq_res=$(printf \"<r><v>10</v></r>\" | xq -r --arg p \"k=\" '$p + .r.v')",
      "yq_res=$(yq -n --arg k \"host\" --arg v \"db\" '{($k): $v}' | tr \"\\n\" \",\")",
      "printf \"%s#%s#%s#%s\\n\" \"$xm_fmt\" \"$xm_c14n\" \"$xq_res\" \"$yq_res\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "<?xml version=\"1.0\"?>|<root>|  <a>1</a>|</root>|#<root a=\"1\" b=\"2\"></root>#k=10#\"host\": \"db\",\n",
  );
});

test("evaluates csvstat -c/--sum/--max, in2csv -n, and csvjoin positional join in sync substitutions (Wave 203)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(csvkitCommands());
  const r = await shell.exec(
    [
      "printf \"id,score\\n1,10\\n2,25\\n\" > /tmp/w203_a.csv",
      "printf \"tag\\nalpha\\nbeta\\n\" > /tmp/w203_b.csv",
      "printf \"{\\\"users\\\":[{\\\"id\\\":1}],\\\"meta\\\":[{\\\"v\\\":2}]}\" > /tmp/w203.json",
      "st_sum=$(csvstat -c score --sum /tmp/w203_a.csv)",
      "st_max=$(csvstat -c score --max /tmp/w203_a.csv)",
      "in_names=$(in2csv -n /tmp/w203.json | tr \"\\n\" \",\")",
      "cj_pos=$(csvjoin /tmp/w203_a.csv /tmp/w203_b.csv | tr \"\\n\" \"|\")",
      "printf \"%s#%s#%s#%s\\n\" \"$st_sum\" \"$st_max\" \"$in_names\" \"$cj_pos\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "35#25#users,meta,#id,score,tag|1,10,alpha|2,25,beta|\n",
  );
});

test("evaluates csvsort -ri/date sorting, csvformat -U2/attached flags, and csvjson bundled flags in sync substitutions (Wave 204)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(csvkitCommands());
  const r = await shell.exec(
    [
      "printf \"name,dt\\nbeta,2025-01-03\\nAlpha,2025-01-01\\n\" > /tmp/w204.csv",
      "s_dt=$(csvsort -c dt /tmp/w204.csv | tr \"\\n\" \"|\")",
      "s_ri=$(csvsort -ri -cname /tmp/w204.csv | tr \"\\n\" \"|\")",
      "fmt_u2=$(printf \"k,v\\na,10\\n\" | csvformat -D \";\" -U2 | tr \"\\n\" \"|\")",
      "cj_res=$(printf \"a\tb\\n01\t2\\n\" | csvjson -tI --stream | tr \"\\n\" \"|\")",
      "printf \"%s#%s#%s#%s\\n\" \"$s_dt\" \"$s_ri\" \"$fmt_u2\" \"$cj_res\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "name,dt|Alpha,2025-01-01|beta,2025-01-03|#name,dt|beta,2025-01-03|Alpha,2025-01-01|#\"k\";\"v\"|\"a\";\"10\"|#{\"a\": \"01\", \"b\": \"2\"}|\n",
  );
});

test("evaluates html-to-markdown blockquote/pre/hr/entities, htmlq -o output file, and which --all in sync substitutions (Wave 205)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  await fs.mkdir("/bin");
  await fs.writeFile("/bin/mytool", new TextEncoder().encode("#!/bin/sh\n"), { mode: 0o755 });
  const shell = new Shell({ fs, cwd: "/tmp", env: { PATH: "/bin" } }).use(standardCommands()).use(htmlToMarkdownCommands()).use(htmlqCommands()).use(whichCommands());
  const r = await shell.exec(
    [
      "md_res=$(printf \"<blockquote>a &amp; b</blockquote><hr><pre><code>x = 1</code></pre>\" | html-to-markdown | tr \"\\n\" \"|\")",
      "hq_empty=$(printf \"<div><span class=\\\"v\\\">ok</span></div>\" | htmlq -t -o /tmp/w205_hq.txt \".v\")",
      "hq_res=$(cat /tmp/w205_hq.txt)",
      "wh_res=$(which --all mytool)",
      "printf \"%s#%s#%s\\n\" \"$md_res\" \"$hq_res\" \"$wh_res\"",
    ].join("\n")
  );
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(
    r.stdout,
    "> a & b||---||```|x = 1|```|#ok#/bin/mytool\n",
  );
});

test("evaluates cal -d/bundled flags, getopt bundled flags, and pathchk/cal/getopt pipeline stages in sync substitutions (Wave 206)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(calCommands()).use(getoptCommands()).use(pathchkCommands());
  const res = await shell.exec(`
    touch /tmp/w206_ok.txt
    export A=1 B=2
    for i in 1 2 3; do
      c1=$(cal -d 2026-05 | head -n 1)
      c2=$(echo ignored | cal -A1 -B1 -d2026-05 | head -n 1)
      g1=$(getopt -qu -o ab: -l alpha,beta: -- -a -b val --alpha --beta=two rest)
      g2=$(echo ignored | getopt -uqo ab: -- -a -b hi pos)
      p1=$(pathchk /tmp/w206_ok.txt | wc -c)
      p2=$(echo ignored | pathchk /tmp/w206_ok.txt)
    done
    printf "%s|%s|%s|%s|%s|%s\n" "$c1" "$c2" "$g1" "$g2" "$p1" "$p2"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    "May 2026        |     April 2026             May 2026             June 2026        | -a -b val --alpha --beta two -- rest| -a -b hi -- pos|0|"
  );
});

test("evaluates readlink -z/-qn, realpath -z/-L, printenv -0, and env -0/-u in sync substitutions (Wave 207)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  await fs.mkdir("/tmp/dir");
  await fs.writeFile("/tmp/dir/target.txt", new TextEncoder().encode("ok"));
  await fs.symlink("/tmp/dir/target.txt", "/tmp/link.txt");
  const shell = new Shell({ fs, cwd: "/tmp", env: { A: "1", B: "2" } })
    .use(standardCommands())
    .use(printenvCommands());
  const res = await shell.exec(`
    export A=1 B=2
    for i in 1 2 3; do
      rl1=$(readlink -f -z /tmp/link.txt /tmp/dir/target.txt | tr "\\0" ":")
      rl2=$(readlink -qn /tmp/link.txt /tmp/link.txt | tr "\\n" ":")
      rp1=$(realpath -L -z /tmp/dir/../link.txt | tr "\\0" ":")
      pe1=$(printenv -0 A B | tr "\\0" ":")
      ev1=$(env -0 -i X=9 Y=8 | tr "\\0" ":")
      ev2=$(echo ignored | env -u A C=3 printenv -0 B C | tr "\\0" ":")
    done
    printf "%s|%s|%s|%s|%s|%s\\n" "$rl1" "$rl2" "$rp1" "$pe1" "$ev1" "$ev2"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    "/tmp/dir/target.txt:/tmp/dir/target.txt:|/tmp/dir/target.txt:/tmp/dir/target.txt:|/tmp/dir/target.txt:|1:2:|Y=8:X=9:|2:3:"
  );
});

test("evaluates iconv -o/multi-file/-sc, dos2unix -q/-qn/bundled flags, and xargs -0r/-0n1 in sync substitutions (Wave 208)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  await fs.writeFile("/tmp/ic1.txt", new TextEncoder().encode("café "));
  await fs.writeFile("/tmp/ic2.txt", new TextEncoder().encode("naïve\n"));
  await fs.writeFile("/tmp/d2u.txt", new TextEncoder().encode("l1\r\nl2\r\n"));
  const shell = new Shell({ fs, cwd: "/tmp" })
    .use(standardCommands())
    .use(iconvCommands())
    .use(dos2unixCommands());
  const res = await shell.exec(`
    for i in 1 2 3; do
      ic1=$(iconv -sc -f UTF-8 -t ASCII /tmp/ic1.txt /tmp/ic2.txt)
      ic_empty=$(iconv -f UTF-8 -t ASCII//IGNORE -o /tmp/ic_out.txt /tmp/ic1.txt /tmp/ic2.txt)
      ic2=$(cat /tmp/ic_out.txt)
      d_empty=$(dos2unix -qn /tmp/d2u.txt /tmp/d2u_out.txt)
      d1=$(cat -E /tmp/d2u_out.txt | tr "\\n" ":")
      x1=$(printf "a\\0b\\0c\\0" | xargs -0rn2 echo | tr "\\n" ":")
    done
    printf "%s|%s|%s|%s\\n" "$ic1" "$ic2" "$d1" "$x1"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    "caf nave|caf nave|l1$:l2$:|a b:c:"
  );
});

test("evaluates xxd default/-i/file stage, od -Ax/-tc/file stage, and hexdump -n/-s/file stage in sync substitutions (Wave 209)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  await fs.writeFile("/tmp/bin.dat", new TextEncoder().encode("AB\n"));
  const shell = new Shell({ fs, cwd: "/tmp" })
    .use(standardCommands())
    .use(xxdCommands())
    .use(odCommands())
    .use(hexdumpCommands());
  const res = await shell.exec(`
    for i in 1 2 3; do
      x1=$(xxd -g 1 /tmp/bin.dat)
      x2=$(xxd -i /tmp/bin.dat | tr "\\n" "|")
      o1=$(od -Ax -tx1 /tmp/bin.dat | head -n 1)
      o2=$(od -An -tc /tmp/bin.dat)
      h1=$(hexdump -C -n2 /tmp/bin.dat | head -n 1)
    done
    printf "%s#%s#%s#%s#%s\\n" "$x1" "$x2" "$o1" "$o2" "$h1"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    "00000000: 41 42 0a                                         AB.#unsigned char _tmp_bin_dat[] = {|  0x41, 0x42, 0x0a|};|unsigned int _tmp_bin_dat_len = 3;|#000000 41 42 0a#   A   B  \\n#00000000  41 42                                             |AB|"
  );
});

test("evaluates md5sum/sha256sum/cksum file operands and --check, base32 file stage, and column -R/-H/-O/-J in sync substitutions (Wave 210)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  await fs.writeFile("/tmp/a.txt", new TextEncoder().encode("hello\n"));
  await fs.writeFile("/tmp/b.txt", new TextEncoder().encode("world\n"));
  await fs.writeFile("/tmp/t1.csv", new TextEncoder().encode("1,alice,95\n"));
  await fs.writeFile("/tmp/t2.csv", new TextEncoder().encode("2,bob,100\n"));
  const shell = new Shell({ fs, cwd: "/tmp" })
    .use(standardCommands())
    .use(byteCommands())
    .use(columnCommands())
    .use(structuredCommands());
  const res = await shell.exec(`
    for i in 1 2 3; do
      m1=$(md5sum /tmp/a.txt)
      m2=$(md5sum /tmp/a.txt /tmp/b.txt | tr "\\n" "|")
      printf "%s\\n" "$m1" > /tmp/a.md5
      mc=$(md5sum -c /tmp/a.md5)
      ck=$(cksum /tmp/a.txt)
      b32=$(base32 -w0 /tmp/a.txt | base32 -di)
      c1=$(column -t -s, -N id,name,score -R score -H id -O score,name /tmp/t1.csv /tmp/t2.csv | tr "\\n" "|")
      c2=$(column -J -n users -s, -N id,name,score -H id /tmp/t1.csv | jq -c .)
    done
    printf "%s#%s#%s#%s#%s#%s#%s\\n" "$m1" "$m2" "$mc" "$ck" "$b32" "$c1" "$c2"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    "b1946ac92492d2347c6235b4d2611184  /tmp/a.txt#b1946ac92492d2347c6235b4d2611184  /tmp/a.txt|591785b794601e212b260e25925636fd  /tmp/b.txt|#/tmp/a.txt: OK#3015617425 6 /tmp/a.txt#hello#score  name|   95  alice|  100  bob|#{\"users\":[{\"name\":\"alice\",\"score\":\"95\"}]}"
  );
});

test("evaluates join -o auto, numfmt --format and whitespace --field, and bc sqrt/length/scale/file operands in sync substitutions (Wave 211)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  await fs.writeFile("/tmp/j1.txt", new TextEncoder().encode("id name\n1 alice\n2 bob\n"));
  await fs.writeFile("/tmp/j2.txt", new TextEncoder().encode("id role\n1 admin\n3 guest\n"));
  await fs.writeFile("/tmp/calc.bc", new TextEncoder().encode("scale=2; x=10; x+=5; sqrt(x*15); length(12345); scale(1.25)\n"));
  const shell = new Shell({ fs, cwd: "/tmp" })
    .use(standardCommands())
    .use(tableTextCommands())
    .use(bcCommands());
  const res = await shell.exec(`
    for i in 1 2 3; do
      j=$(join --header -a1 -a2 -e NULL -o auto /tmp/j1.txt /tmp/j2.txt | tr "\\n" "|")
      nf1=$(printf "item 2048\\n" | numfmt --to iec --field 2 --format "%06.1f")
      nf2=$(numfmt --from si --to iec-i 2K)
      b=$(bc /tmp/calc.bc | tr "\\n" ":")
    done
    printf "%s#%s#%s#%s\\n" "$j" "$nf1" "$nf2" "$b"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    "id name role|1 alice admin|2 bob NULL|3 NULL guest|#item 002.0K#2.0Ki#15.00:5:2:"
  );
});

test("evaluates dirname/basename -z/--suffix, seq -ws/--separator/+nums, and expr parentheses/string comparison in sync substitutions (Wave 212)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  await fs.writeFile("/tmp/graph.txt", new TextEncoder().encode("a b\nb c\n"));
  const shell = new Shell({ fs, cwd: "/tmp" })
    .use(standardCommands())
    .use(tableTextCommands())
    .use(exprCommands())
    .use(tsortCommands());
  const res = await shell.exec(`
    for i in 1 2 3; do
      dn=$(dirname -z /tmp/a/b /tmp/c/d | tr "\\0" ":")
      bn=$(basename --suffix=.txt /tmp/alpha.txt /tmp/beta.txt | tr "\\n" ":")
      sq=$(seq -ws: +1 +3 +10)
      ex1=$(expr \\( 2 + 3 \\) \\* 4)
      ex2=$(expr "apple" \\< "banana" \\& "fallback" \\| "none")
      ts=$(tsort < /tmp/graph.txt | tr "\\n" ":")
    done
    printf "%s#%s#%s#%s#%s#%s\\n" "$dn" "$bn" "$sq" "$ex1" "$ex2" "$ts"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    "/tmp/a:/tmp/c:#alpha:beta:#01:04:07:10#20#1#a:b:c:"
  );
});

test("sync sort (-g/--general-numeric-sort/-z/--field-separator/--key), uniq (--skip-fields/--skip-chars/--check-chars/-z/bundled), and cut (-z/bundled -s) in substitutions (Wave 213)", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp");
  const shell = new Shell({ fs: memFs, cwd: "/tmp" }).use(standardCommands()).use(tableTextCommands());
  const result = await shell.exec(`
    printf "1e2\\n3\\n-2e1\\nNaN\\n-inf\\n+inf\\n" > /tmp/gnum.txt
    printf "a:1e2\\nb:3\\nc:100\\n" > /tmp/gkey.txt
    printf "b\\0a\\0c\\0" > /tmp/zsort.bin
    printf "x 10\\ny 10\\nz 20\\n" > /tmp/u1.txt
    printf "aa1\\nab1\\nac2\\n" > /tmp/u2.txt

    out=""
    for i in 1 2 3 4 5; do
      s1=$(sort -g /tmp/gnum.txt | paste -sd,)
      s2=$(sort --field-separator : --key 2,2g -s /tmp/gkey.txt | paste -sd,)
      s3=$(sort -z /tmp/zsort.bin | tr "\\0" ":")
      s4=$(printf "z:9\\0a:2\\0m:5\\0" | sort -z -t: -k2,2nr | tr "\\0" "|")
      u1=$(uniq --skip-fields 1 -c /tmp/u1.txt | tr -s " " | paste -sd,)
      u2=$(uniq --skip-chars 2 --check-chars 1 /tmp/u2.txt | paste -sd,)
      u3=$(printf "foo\\0foo\\0bar\\0" | uniq -zc | tr -s " " | tr "\\0" ";")
      u4=$(uniq -cf1 /tmp/u1.txt | tr -s " " | paste -sd,)
      c1=$(printf "a:b:c\\0no_delim\\0d:e:f\\0" | cut -zs -d: -f2 | tr "\\0" ",")
      c2=$(printf "p:q:r\\nplain\\nx:y:z\\n" | cut -d: -sf1,3 | paste -sd,)
      out="$s1|$s2|$s3|$s4|$u1|$u2|$u3|$u4|$c1|$c2"
    done
    printf "%s\\n" "$out"
  `);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    "NaN,-inf,-2e1,3,1e2,+inf|b:3,a:1e2,c:100|a:b:c:|z:9|m:5|a:2|| 2 x 10, 1 z 20|aa1,ac2| 2 foo; 1 bar;| 2 x 10, 1 z 20|b,e,|p:r,x:z"
  );
});

test("sync paste -z, comm -z, fold -N, expand -it/-N, unexpand -at/-N, and base64 --wrap in substitutions (Wave 214)", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp");
  const shell = new Shell({ fs: memFs, cwd: "/tmp" }).use(standardCommands()).use(tableTextCommands()).use(byteCommands());
  const result = await shell.exec(`
    printf "%s\\0" a b c > /tmp/pz1.bin
    printf "%s\\0" 1 2 3 > /tmp/pz2.bin
    printf "a\\0b\\0c\\0" > /tmp/cz1.bin
    printf "b\\0c\\0d\\0" > /tmp/cz2.bin

    out=""
    for i in 1 2 3 4 5; do
      p1=$(paste -zd: /tmp/pz1.bin /tmp/pz2.bin | tr "\\0" ",")
      p2=$(printf "x\\0y\\0z\\0" | paste -zsd- - | tr "\\0" "!")
      cm=$(comm -z12 /tmp/cz1.bin /tmp/cz2.bin | tr "\\0" ":")
      fd=$(printf "hello world foo\\n" | fold -s6 | paste -sd"|")
      ex=$(printf "\\ta\\t\\tb\\n" | expand -it4 | tr " " ".")
      ux=$(printf "    a   b\\n" | unexpand -at4 | tr "\\t" ">")
      b6=$(printf "abcdefghijkl" | base64 --wrap 4 | paste -sd:)
      out="$p1#$p2#$cm#$fd#$ex#$ux#$b6"
    done
    printf "%s\\n" "$out"
  `);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    "a:1,b:2,c:3,#x-y-z!#b:c:#hello |world |foo#....a		b#>a>b#YWJj:ZGVm:Z2hp:amts"
  );
});

test("sync sed (-z/--expression/-ne/-Ee), grep (-lZ/--regexp/--max-count/-ie), and awk (--field-separator/--assign) in substitutions (Wave 215)", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp");
  const shell = new Shell({ fs: memFs, cwd: "/tmp" }).use(standardCommands()).use(tableTextCommands()).use(textProgramCommands());
  const result = await shell.exec(`
    printf "foo\\nbar\\n" > /tmp/g1.txt
    printf "baz\\nFOO\\n" > /tmp/g2.txt
    printf "%s\\0" alpha beta gamma > /tmp/sz.bin

    out=""
    for i in 1 2 3 4 5; do
      sd1=$(sed -z -ne "1,2p" /tmp/sz.bin | tr "\\0" ":")
      sd2=$(printf "aa11\\nbb22\\n" | sed --expression "s/[0-9]+/X/g" -E | paste -sd,)
      gp1=$(grep -lZ -ie "foo" /tmp/g1.txt /tmp/g2.txt | tr "\\0" "|")
      gp2=$(printf "Alpha\\nalPha\\nbeta\\nALPHA\\n" | grep --regexp "alpha" -i --max-count 2 | paste -sd,)
      ak1=$(printf "a:10\\nb:25\\nc:5\\n" | awk --field-separator : --assign s=100 '{ s += $2 } END { print s }')
      out="$sd1#$sd2#$gp1#$gp2#$ak1"
    done
    printf "%s\\n" "$out"
  `);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    "alpha:beta:#aaX,bbX#/tmp/g1.txt|/tmp/g2.txt|#Alpha,alPha#140"
  );
});

test("Wave 216: jq -R/-Rs/-j/-S/--tab/--indent, multi-path del, 2-arg any/all, first/last/limit/isempty, and general *_by in sync substitutions", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp");
  const shell = new Shell({ fs: memFs, cwd: "/tmp" }).use(standardCommands()).use(structuredCommands());
  const res = await shell.exec(`
    r1=$(printf "alpha\nbeta\ngamma\n" | jq -R -c '"[" + . + "]"')
    r2=$(printf "line1\nline2\n" | jq -Rs -c 'split("\\n")')
    r3=$(printf '{"z":1,"a":{"d":4,"b":2}}\n' | jq -cS '.')
    r4=$(printf '["a","b","c"]\n' | jq -j '.[]')
    r5=$(printf '{"a":1,"b":{"x":2,"y":3},"c":4}\n' | jq -c 'del(.a, .b.x)')
    r6=$(printf '[10,20,30,40]\n' | jq -c 'del(.[1], .[-1])')
    r7=$(printf '{"items":[2,4,7]}\n' | jq -c '[any(.items[]; . > 5), all(.items[]; . > 0)]')
    r8=$(printf '[1,2,3,4,5]\n' | jq -c '[first(.[] | select(. > 2)), last(.[] | select(. < 5)), limit(2; .[]), isempty(.[] | select(. > 9))]')
    r9=$(printf '[{"a":2,"b":5},{"a":1,"b":2},{"a":3,"b":1}]\n' | jq -c 'sort_by(.a + .b) | map(.a)')
    printf "%s|%s|%s|%s|%s|%s|%s|%s|%s\n" "$(printf "%s" "$r1" | tr "\n" ",")" "$r2" "$r3" "$r4" "$r5" "$r6" "$r7" "$r8" "$r9"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    `"[alpha]","[beta]","[gamma]"|["line1","line2",""]|{"a":{"b":2,"d":4},"z":1}|abc|{"b":{"y":3},"c":4}|[10,30]|[true,true]|[3,4,1,2,true]|[1,3,2]`
  );
});

test("Wave 217: yq nested YAML mappings/sequences and mdq ordered lists, multi-hash headings, and --no-br in sync substitutions", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp");
  const shell = new Shell({ fs: memFs, cwd: "/tmp" }).use(standardCommands()).use(tableTextCommands()).use(yqCommands()).use(mdqCommands());
  const res = await shell.exec(`
    cat <<'EOF' > /tmp/items.yaml
items:
  - id: 1
    name: alpha
  - id: 2
    name: beta
EOF
    cat <<'EOF' > /tmp/doc.md
# Main Title

## Section One

1. first step
2. second step

## Section Two

1. third step
EOF
    out=""
    for i in 1 2 3 4 5; do
      y1=$(yq -o json -c '.items | map(.name)' /tmp/items.yaml)
      y2=$(yq -n '{a: {b: 1, c: [2, 3]}}' | paste -sd"|")
      m1=$(mdq -o plain --no-br '1.' /tmp/doc.md | paste -sd",")
      m2=$(mdq -o plain --no-br '## Section Two | 1.' /tmp/doc.md)
      out="$y1#$y2#$m1#$m2"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    `["alpha","beta"]#"a":|  "b": 1|  "c":|    - 2|    - 3#first step,second step,third step#third step`
  );
});

test("Wave 218: xmllint --xpath= union/child/text/position predicates and xq -cS/-j in sync substitutions", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp");
  const shell = new Shell({ fs: memFs, cwd: "/tmp" }).use(standardCommands()).use(tableTextCommands()).use(xmlCommands());
  const res = await shell.exec(`
    cat <<'EOF' > /tmp/data.xml
<catalog>
  <item id="a" role="admin"><name>alpha</name><status>active</status></item>
  <item id="b" role="user"><name>beta</name><status>inactive</status></item>
  <item id="c" role="user"><name>gamma</name><status>active</status></item>
</catalog>
EOF
    out=""
    for i in 1 2 3 4 5; do
      x1=$(xmllint --xpath='string(//item[status="active"][position()=2]/name)' /tmp/data.xml)
      x2=$(xmllint --xpath '//item[@id="a"]/name/text() | //item[@id="c"]/name/text()' /tmp/data.xml | paste -sd",")
      x3=$(xmllint --xpath 'string(//item[@role!="admin"][name="beta"]/@id)' /tmp/data.xml)
      xq1=$(printf '<r><z>1</z><a>2</a></r>' | xq -cS '.r')
      xq2=$(printf '<r><w>foo</w><w>bar</w></r>' | xq -j '.r.w[]')
      out="$x1#$x2#$x3#$xq1#$xq2"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    `gamma#alpha,gamma#b#{"a":"2","z":"1"}#foobar`
  );
});

test("Wave 219: fd -S/-0/-t e, rg -S/--files-without-match/-l0/-ie, and find -print0 in sync substitutions", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp/w219", { recursive: true });
  await memFs.mkdir("/tmp/w219/emptydir", { recursive: true });
  const shell = new Shell({ fs: memFs, cwd: "/tmp/w219" }).use(standardCommands()).use(fdCommands()).use(searchCommands());
  const res = await shell.exec(`
    printf "AlphaLine\\n" > /tmp/w219/a.txt
    printf "bravo\\n" > /tmp/w219/b.txt
    printf "" > /tmp/w219/empty.txt
    out=""
    for i in 1 2 3 4 5; do
      f1=$(fd -0 -S +7b . /tmp/w219 | tr "\\0" ":")
      f2=$(fd -t e . /tmp/w219 | tr "\\n" ",")
      r1=$(rg -S "alphaline" /tmp/w219/a.txt /tmp/w219/b.txt -I)
      r2=$(rg -S "Alphaline" /tmp/w219/a.txt /tmp/w219/b.txt -I || printf "nomatch")
      r3=$(rg --files-without-match "Alpha" /tmp/w219/a.txt /tmp/w219/b.txt)
      r4=$(rg -l0 -ie "alpha" /tmp/w219/a.txt /tmp/w219/b.txt | tr "\\0" ":")
      fn1=$(find /tmp/w219 -maxdepth 1 -name "*.txt" -print0 | sort -z | tr "\\0" "|")
      out="$f1#$f2#$r1#$r2#$r3#$r4#$fn1"
    done
    printf "%s\\n" "$out"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    `/tmp/w219/a.txt:#/tmp/w219/empty.txt,/tmp/w219/emptydir,#AlphaLine#nomatch#/tmp/w219/b.txt#/tmp/w219/a.txt:#/tmp/w219/a.txt|/tmp/w219/b.txt|/tmp/w219/empty.txt|`
  );
});

test("Wave 220: xan headers --csv, xan slice -S/--start-condition -E/--end-condition, and xan count -c/-a/-t in sync substitutions", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp");
  const shell = new Shell({ fs: memFs, cwd: "/tmp" }).use(standardCommands()).use(tableTextCommands()).use(xanCommands());
  const res = await shell.exec(`
    cat <<'EOF' > /tmp/metrics.csv
id,name,score
1,alpha,10
2,beta,20
3,gamma,30
4,delta,40
EOF
    out=""
    for i in 1 2 3 4 5; do
      xh=$(xan headers --csv /tmp/metrics.csv | paste -sd",")
      xs=$(xan slice -S 'score >= 20' -E 'name == "delta"' /tmp/metrics.csv | paste -sd"|")
      xc=$(xan count -c -a -t 2 /tmp/metrics.csv)
      out="$xh#$xs#$xc"
    done
    printf "%s\\n" "$out"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    `/tmp/metrics.csv,id,name,score#id,name,score|2,beta,20|3,gamma,30#4`
  );
});

test("Wave 221: tree -Ji/--sort=version, multi-operand ls and ls -L, and du -0 in sync substitutions", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp/w221", { recursive: true });
  const shell = new Shell({ fs: memFs, cwd: "/tmp/w221" }).use(standardCommands()).use(tableTextCommands()).use(treeCommands()).use(duCommands());
  const res = await shell.exec(`
    printf "hello" > /tmp/w221/v2.txt
    printf "world!" > /tmp/w221/v10.txt
    ln -s /tmp/w221/v10.txt /tmp/w221/link.txt
    out=""
    for i in 1 2 3 4 5; do
      tj=$(tree -Ji --noreport -I "link.txt" /tmp/w221)
      tv=$(tree -i --noreport --sort=version -I "link.txt" /tmp/w221 | paste -sd",")
      lm=$(ls /tmp/w221/v10.txt /tmp/w221/v2.txt | paste -sd",")
      ll=$(ls -LF /tmp/w221/link.txt)
      du0=$(du -0 -bs /tmp/w221/v2.txt /tmp/w221/v10.txt | tr "\\0\\t" ":=")
      out="$tj#$tv#$lm#$ll#$du0"
    done
    printf "%s\\n" "$out"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    `[{"type":"directory","name":"/tmp/w221","contents":[{"type":"file","name":"v10.txt"},{"type":"file","name":"v2.txt"}]}]#/tmp/w221,v2.txt,v10.txt#/tmp/w221/v10.txt,/tmp/w221/v2.txt#/tmp/w221/link.txt#5=/tmp/w221/v2.txt:6=/tmp/w221/v10.txt:`
  );
});

test("Wave 222: patch --dry-run/-o/-R and diff -sp/-sy --suppress-common-lines in sync substitutions", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp/w222", { recursive: true });
  const shell = new Shell({ fs: memFs, cwd: "/tmp/w222" }).use(standardCommands()).use(diffPatchCommands());
  const res = await shell.exec(`
    printf "alpha\\nbeta\\n" > /tmp/w222/orig.txt
    cat <<'EOF' > /tmp/w222/change.patch
--- a/orig.txt
+++ b/orig.txt
@@ -1,2 +1,2 @@
 alpha
-beta
+gamma
EOF
    out=""
    for i in 1 2 3 4 5; do
      p_dry=$(patch --dry-run /tmp/w222/orig.txt /tmp/w222/change.patch)
      p_out=$(patch -o /tmp/w222/patched.txt /tmp/w222/orig.txt /tmp/w222/change.patch)
      p_rev=$(patch -R -o /tmp/w222/reverted.txt /tmp/w222/patched.txt /tmp/w222/change.patch)
      d_same=$(diff -sp /tmp/w222/orig.txt /tmp/w222/reverted.txt)
      out="$p_dry|$p_out|$p_rev|$d_same"
    done
    printf "%s\\n" "$out"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    `checking file /tmp/w222/orig.txt|patching file /tmp/w222/patched.txt (read from /tmp/w222/orig.txt)|patching file /tmp/w222/reverted.txt (read from /tmp/w222/patched.txt)|Files /tmp/w222/orig.txt and /tmp/w222/reverted.txt are identical`
  );
});

test("Wave 223: install -dv multi-level directories and dd bs=NxM/cbs/conv=block/unblock/sync and /dev/zero in sync substitutions", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp/w223_root", { recursive: true });
  const shell = new Shell({ fs: memFs, cwd: "/tmp/w223_root" }).use(standardCommands()).use(installCommands()).use(ddCommands());
  const res = await shell.exec(`
    for i in 1 2 3 4 5; do
      rm -rf /tmp/w223
      out1=$(install -dv /tmp/w223/a/b/c)
      echo "hello" > /tmp/w223/src.txt
      out2=$(install -Dv -m 644 /tmp/w223/src.txt /tmp/w223/nested/dir/dst.txt)
      out3=$(printf "hi\\nthere!\\n" | dd cbs=4 conv=block status=none)
      out4=$(printf "hi  ther" | dd cbs=4 conv=unblock status=none | tr "\\n" "|")
      out5=$(dd if=/dev/zero bs=2x3 count=2 status=none | tr "\\0" "Z")
      out6=$(dd if=/tmp/w223/src.txt of=/tmp/w223/dd_out.txt bs=1 count=5B conv=ucase status=none && cat /tmp/w223/dd_out.txt)
    done
    printf "%s\\n---\\n%s\\n---\\n<%s>|<%s>|<%s>|<%s>\\n" "$out1" "$out2" "$out3" "$out4" "$out5" "$out6"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "install: creating directory '/tmp/w223'\n" +
    "install: creating directory '/tmp/w223/a'\n" +
    "install: creating directory '/tmp/w223/a/b'\n" +
    "install: creating directory '/tmp/w223/a/b/c'\n" +
    "---\n" +
    "install: creating directory '/tmp/w223/nested'\n" +
    "install: creating directory '/tmp/w223/nested/dir'\n" +
    "'/tmp/w223/src.txt' -> '/tmp/w223/nested/dir/dst.txt'\n" +
    "---\n" +
    "<hi  ther>|<hi|ther|>|<ZZZZZZZZZZZZ>|<HELLO>\n"
  );
});

test("Wave 224: realpath/readlink physical symlink .. traversal, stat %U/%G/%m/--cached, and df DF_BLOCK_SIZE=human-readable in sync substitutions", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp/w224/sub/deep", { recursive: true });
  await memFs.writeFile("/tmp/w224/sub/sibling.txt", new TextEncoder().encode("ok\n"));
  await memFs.symlink("/tmp/w224/sub/deep", "/tmp/w224/link");
  const { dfCommands } = await import("../../src/commands/df/index.ts");
  const shell = new Shell({ fs: memFs, cwd: "/tmp/w224" })
    .use(standardCommands())
    .use(metadataCommands())
    .use(dfCommands());
  const res = await shell.exec(`
    export DF_BLOCK_SIZE=human-readable
    for i in 1 2 3 4 5; do
      p_phys=$(realpath /tmp/w224/link/../sibling.txt)
      p_log=$(realpath -L /tmp/w224/link/../sub/sibling.txt)
      p_miss=$(readlink -m /tmp/w224/missing/../link/../sibling.txt)
      st_ug=$(stat --cached=default -c "%U:%G:%m:%a" /tmp/w224/sub/sibling.txt)
      df_hr=$(df --output=source,size,target /tmp | tail -n 1)
    done
    printf "%s|%s|%s|%s|%s\n" "$p_phys" "$p_log" "$p_miss" "$st_ug" "$df_hr"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    "/tmp/w224/sub/sibling.txt|/tmp/w224/sub/sibling.txt|/tmp/w224/sub/sibling.txt|root:root:/:666|tmpfs           256M /tmp"
  );
});

test("Wave 225: csvstat --median/--stdev/--max-precision, text --min/--max, and in2csv -s fixed-width schema in sync substitutions", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp/w225", { recursive: true });
  await memFs.writeFile(
    "/tmp/w225/data.csv",
    new TextEncoder().encode("name,score\ncharlie,10.25\nalice,20.5\nbob,30.125\n")
  );
  await memFs.writeFile(
    "/tmp/w225/schema.csv",
    new TextEncoder().encode("column,start,length\nid,1,3\nlabel,4,5\n")
  );
  await memFs.writeFile(
    "/tmp/w225/fixed.txt",
    new TextEncoder().encode("001alpha\n002beta \n")
  );
  const shell = new Shell({ fs: memFs, cwd: "/tmp/w225" })
    .use(standardCommands())
    .use(csvkitCommands());
  const res = await shell.exec(`
    for i in 1 2 3 4 5; do
      med=$(csvstat -c score --median /tmp/w225/data.csv)
      std=$(csvstat -c score --stdev /tmp/w225/data.csv)
      prec=$(csvstat -c score --max-precision /tmp/w225/data.csv)
      tmin=$(csvstat -c name --min /tmp/w225/data.csv)
      tmax=$(csvstat -c name --max /tmp/w225/data.csv)
      fcsv=$(in2csv -s /tmp/w225/schema.csv /tmp/w225/fixed.txt | tr "\n" ";")
    done
    printf "%s|%s|%s|%s|%s|%s\n" "$med" "$std" "$prec" "$tmin" "$tmax" "$fcsv"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    "20.5|9.939|3|alice|charlie|id,label;001,alpha;002,beta;"
  );
});

test("Wave 226: sqlite3 file database persistence, .dump/.save/.read, and openssl -out file in sync substitutions", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp/w226", { recursive: true });
  await memFs.writeFile(
    "/tmp/w226/init.sql",
    new TextEncoder().encode("CREATE TABLE items(id INT, label TEXT);\nINSERT INTO items VALUES(1, 'alpha');\n")
  );
  const { sqlite3Commands } = await import("../../src/commands/sqlite3/index.ts");
  const { opensslCommands } = await import("../../src/commands/openssl/index.ts");
  const shell = new Shell({ fs: memFs, cwd: "/tmp/w226" })
    .use(standardCommands())
    .use(sqlite3Commands())
    .use(opensslCommands());
  const res = await shell.exec(`
    for i in 1 2 3 4 5; do
      rm -f /tmp/w226/app.db /tmp/w226/copy.db /tmp/w226/b64.txt
      _=$(sqlite3 /tmp/w226/app.db ".read /tmp/w226/init.sql" "INSERT INTO items VALUES(2, 'beta');" ".save /tmp/w226/copy.db")
      q1=$(sqlite3 -csv /tmp/w226/copy.db "SELECT * FROM items ORDER BY id;" | tr "\n" ";")
      dmp=$(sqlite3 /tmp/w226/copy.db ".dump" | grep "INSERT INTO")
      _=$(printf "hello-openssl" | openssl base64 -A -out /tmp/w226/b64.txt)
      b64=$(cat /tmp/w226/b64.txt)
    done
    printf "%s|%s|%s\n" "$q1" "$(printf "%s" "$dmp" | tr "\n" ";")" "$b64"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    "1,alpha;2,beta;|INSERT INTO items VALUES(1,'alpha');;INSERT INTO items VALUES(2,'beta');|aGVsbG8tb3BlbnNzbA=="
  );
});

test("Wave 227: apply_patch Delete File, Move to, and nested Add File in sync substitutions", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp/w227", { recursive: true });
  const { applyPatchCommands } = await import("../../src/commands/apply-patch/index.ts");
  const shell = new Shell({ fs: memFs, cwd: "/tmp/w227" })
    .use(standardCommands())
    .use(applyPatchCommands());
  const res = await shell.exec(`
    for i in 1 2 3 4 5; do
      rm -rf /tmp/w227/old.txt /tmp/w227/obsolete.txt /tmp/w227/sub
      printf "line1\nline2\n" > /tmp/w227/old.txt
      printf "bye\n" > /tmp/w227/obsolete.txt
      out=$(apply_patch <<'EOF'
*** Begin Patch
*** Add File: sub/added.txt
+hello nested
*** Update File: old.txt
*** Move to: sub/renamed.txt
@@
 line1
-line2
+line2-updated
*** Delete File: obsolete.txt
*** End Patch
EOF
)
      c1=$(cat /tmp/w227/sub/added.txt)
      c2=$(cat /tmp/w227/sub/renamed.txt | tr "\n" ":")
      ex=$(test -e /tmp/w227/obsolete.txt && echo "exists" || echo "deleted")
    done
    printf "%s|%s|%s|%s\n" "$(printf "%s" "$out" | tr "\n" ";")" "$c1" "$c2" "$ex"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    "Success. Updated the following files:;A sub/added.txt;M sub/renamed.txt;D obsolete.txt|hello nested|line1:line2-updated:|deleted"
  );
});

test("Wave 228: tar -xvf -C directory extraction and unzip -t / unzip -qo -d extraction in sync substitutions", async () => {
  const memFs = new MemoryFileSystem();
  await memFs.mkdir("/tmp/w228/src/pkg", { recursive: true });
  await memFs.writeFile("/tmp/w228/src/pkg/hello.txt", new TextEncoder().encode("tar-extracted\n"));
  const shell = new Shell({ fs: memFs, cwd: "/tmp/w228" })
    .use(standardCommands())
    .use(archiveCommands());
  const setupRes = await shell.exec(`
    tar -czf /tmp/w228/pkg.tar.gz -C /tmp/w228/src pkg/hello.txt
    cd /tmp/w228/src && zip -q /tmp/w228/pkg.zip pkg/hello.txt
  `);
  assert.equal(setupRes.exitCode, 0, setupRes.stderr);

  const res = await shell.exec(`
    for i in 1 2 3 4 5; do
      rm -rf /tmp/w228/out_tar /tmp/w228/out_zip
      mkdir -p /tmp/w228/out_tar /tmp/w228/out_zip
      tv=$(tar -xzvf /tmp/w228/pkg.tar.gz -C /tmp/w228/out_tar)
      tc=$(cat /tmp/w228/out_tar/pkg/hello.txt)
      ut=$(unzip -tq /tmp/w228/pkg.zip)
      _=$(unzip -qo /tmp/w228/pkg.zip -d /tmp/w228/out_zip)
      zc=$(cat /tmp/w228/out_zip/pkg/hello.txt)
    done
    printf "%s|%s|%s|%s\n" "$tv" "$tc" "$ut" "$zc"
  `);
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    "pkg/hello.txt|tar-extracted|No errors detected in compressed data of /tmp/w228/pkg.zip.|tar-extracted"
  );

  it("supports truncate relative clamping/-r modes, csplit repeated regex {*}/{N}, and patch -o -/new-file/no-newline in sync command substitutions (Wave 229)", async () => {
    const shell = createShell();
    const res = await shell.exec(`
      out=""
      for i in 1 2; do
        printf "hello" > /tmp/w229_small.txt
        printf "0123456789" > /tmp/w229_ref.txt
        t_clamp=\$(truncate -s -100 /tmp/w229_small.txt && wc -c < /tmp/w229_small.txt | tr -d " ")
        printf "abc" > /tmp/w229_gt.txt
        t_ref_gt=\$(truncate -r /tmp/w229_ref.txt -s ">6" /tmp/w229_gt.txt && wc -c < /tmp/w229_gt.txt | tr -d " ")
        printf "header\n===\nsec1\n===\nsec2\n===\nsec3\n" > /tmp/w229_cs.txt
        cs_out=\$(csplit -f /tmp/w229_xx -b "%02d" /tmp/w229_cs.txt "/^===$/" "{*}" | tr "\n" ",")
        cs_f1=\$(cat /tmp/w229_xx01 | tr "\n" "|")
        cs_f3=\$(cat /tmp/w229_xx03 | tr "\n" "|")
        printf "a\nb\n" > /tmp/w229_orig.txt
        printf -- "--- a/w229_orig.txt\n+++ b/w229_orig.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n\\ No newline at end of file\n" > /tmp/w229.patch
        p_stdout=\$(patch -s -o - /tmp/w229_orig.txt /tmp/w229.patch)
        rm -f /tmp/w229_new.txt
        printf -- "--- /dev/null\n+++ b/w229_new.txt\n@@ -0,0 +1,2 @@\n+first\n+second\n" > /tmp/w229_new.patch
        p_new=\$(patch -s /tmp/w229_new.txt /tmp/w229_new.patch && cat /tmp/w229_new.txt | tr "\n" "|")
        out="${t_clamp}:${t_ref_gt}:${cs_out}:${cs_f1}:${cs_f3}:${p_stdout}:${p_new}"
      done
      printf "%s\n" "\$out"
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout.trim(),
      "0:10:7,9,9,9,:===|sec1|:===|sec3|:a\nB:first|second|",
    );
  });

  it("supports mkdir symbolic modes (-m u=rwx,go=rx), ln -sr relative symlinks, and rm -rv recursive verbose/symlink removal in sync command substitutions (Wave 230)", async () => {
    const shell = createShell();
    const res = await shell.exec(`
      out=""
      for i in 1 2; do
        rm -rf /tmp/w230_tree /tmp/w230_symdir
        mk_out=\$(mkdir -v -m u=rwx,g=rx,o= /tmp/w230_symdir && stat -c "%a" /tmp/w230_symdir)
        mkdir -p /tmp/w230_tree/a/b /tmp/w230_tree/a/c
        printf "target-data" > /tmp/w230_tree/a/b/file.txt
        ln_out=\$(ln -srv /tmp/w230_tree/a/b/file.txt /tmp/w230_tree/a/c/link.txt)
        rl_out=\$(readlink /tmp/w230_tree/a/c/link.txt)
        rm_sym=\$(rm -v /tmp/w230_tree/a/c/link.txt)
        rm_tree=\$(rm -rv /tmp/w230_tree/a | tr "\n" "|")
        out="${mk_out}|${ln_out}|${rl_out}|${rm_sym}|${rm_tree}"
      done
      printf "%s\n" "\$out"
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout.trim(),
      "mkdir: created directory '/tmp/w230_symdir'\n750|'/tmp/w230_tree/a/c/link.txt' -> '../b/file.txt'|../b/file.txt|removed '/tmp/w230_tree/a/c/link.txt'|removed '/tmp/w230_tree/a/b/file.txt'|removed '/tmp/w230_tree/a/b'|removed '/tmp/w230_tree/a/c'|removed '/tmp/w230_tree/a'|",
    );
  });

  it("supports env -S/--split-string, xargs cat/wc/head/tail, and timeout -s/-k 0/0 duration in sync command substitutions (Wave 231)", async () => {
    const shell = createShell();
    const res = await shell.exec(`
      export W231_PREFIX="prod"
      printf "alpha\\nbeta\\ngamma\\n" > /tmp/w231_a.txt
      printf "delta\\nepsilon\\n" > /tmp/w231_b.txt
      out=""
      for i in 1 2; do
        env_s=\$(env -S 'APP=\${W231_PREFIX}_svc printenv APP')
        x_cat=\$(printf "/tmp/w231_a.txt\\n/tmp/w231_b.txt\\n" | xargs cat -n | tr "\\n" "|")
        x_wc=\$(printf "/tmp/w231_a.txt\\n/tmp/w231_b.txt\\n" | xargs wc -l | tr -s " " | tr "\\n" "|")
        x_head=\$(printf "/tmp/w231_a.txt\\n/tmp/w231_b.txt\\n" | xargs head -q -n 1 | tr "\\n" ",")
        to_sig=\$(timeout -s TERM -k 0 5s printf "%s=%d," k1 10 k2 20)
        to_zero=\$(timeout 0 basename /usr/local/bin/tool.sh .sh)
        out="\${env_s}|\${x_head}|\${to_sig}|\${to_zero}"
      done
      printf "%s\\n" "\$out"
    `);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(
      res.stdout.trim(),
      "prod_svc|alpha,delta,|k1=10,k2=20,|tool",
    );
  });
});
