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
