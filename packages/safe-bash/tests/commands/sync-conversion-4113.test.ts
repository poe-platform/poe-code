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
