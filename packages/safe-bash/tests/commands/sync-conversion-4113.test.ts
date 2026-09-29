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
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands());
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

test("evaluates jq -n/--null-input, -s/--slurp, --arg, --argjson, dynamic object keys {(\$k): \$v}, and multi-file jq in sync substitutions, pipelines, and brace loops (Wave 169)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new Shell({ fs, cwd: "/tmp" }).use(standardCommands()).use(structuredCommands());
  const res = await shell.exec([
    "printf '{\"id\":10,\"name\":\"alpha\"}\\n' > /tmp/j1.json",
    "printf '{\"id\":25,\"name\":\"beta\"}\\n' > /tmp/j2.json",
    "j_null=$(jq -n -c --arg k \"host\" --arg v \"localhost\" --argjson port 8080 '{(\$k): \$v, \$port}')",
    "j_sel=$(jq -r --arg target \"beta\" 'select(.name == \$target) | .id' /tmp/j1.json /tmp/j2.json)",
    "j_slurp=$(jq -s -c 'map(.id) | add' /tmp/j1.json /tmp/j2.json)",
    "j_pipe=$(jq -r '.name' /tmp/j1.json /tmp/j2.json | tr '\\n' ':')",
    "loop_out=\"\"",
    "for i in {1..2}; do",
    "  item=$(jq -n -c --arg idx \"$i\" '{step: (\$idx | tonumber)}' | jq -r '.step')",
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
