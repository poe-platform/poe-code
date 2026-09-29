import { createAgentCommands } from "../../src/plugins/index.js";
import { evalSyncRmdir, evalSyncRm } from "../../src/commands/internal.js";
import { createCmpCommands } from "../../src/commands/cmp/index.js";
import { createExprCommands } from "../../src/commands/expr/index.js";
import { createBcCommands } from "../../src/commands/bc/index.js";
import { createFmtCommands } from "../../src/commands/fmt/index.js";
import { createFoldCommands } from "../../src/commands/fold/index.js";
import { createHostnameCommands } from "../../src/commands/hostname/index.js";
import { createIdCommands } from "../../src/commands/id/index.js";
import { createNprocCommands } from "../../src/commands/nproc/index.js";
import { createNumfmtCommands } from "../../src/commands/numfmt/index.js";
import { createOdCommands } from "../../src/commands/od/index.js";
import { createSha512sumCommands } from "../../src/commands/sha512sum/index.js";
import { createUnameCommands } from "../../src/commands/uname/index.js";
import { createWhoamiCommands } from "../../src/commands/whoami/index.js";
import { createXxdCommands } from "../../src/commands/xxd/index.js";
import { createSofficeCommands } from "../../src/commands/soffice/index.js";
import { createSsconvertCommands } from "../../src/commands/ssconvert/index.js";
import { createWkhtmltopdfCommands } from "../../src/commands/wkhtmltopdf/index.js";
import { createOpCommands } from "../../src/commands/op/index.js";
import { createGitCommands } from "../../src/commands/git/index.js";
import { createArchiveCommands } from "../../src/commands/archive/index.js";
import { createTimeoutCommands, evalSyncTimeout } from "../../src/commands/timeout/index.js";
import { createSplitCommands } from "../../src/commands/split/index.js";
import { createCsplitCommands } from "../../src/commands/csplit/index.js";
import { createNetworkCommands } from "../../src/commands/network/public.js";
import { createSpongeCommands } from "../../src/commands/sponge/index.js";
import { createTruncateCommands } from "../../src/commands/truncate/index.js";
import { createInstallCommands } from "../../src/commands/install/index.js";
import { createApplyPatchCommands } from "../../src/commands/apply-patch/index.js";
import { createPdftoppmCommands } from "../../src/commands/pdftoppm/index.js";
import { createMmdcCommands } from "../../src/commands/mmdc/index.js";
import { createPandocCommands } from "../../src/commands/pandoc/index.js";
import { createFfmpegCommands } from "../../src/commands/ffmpeg/index.js";
import { createGhCommands } from "../../src/commands/gh/index.js";
import { createSipsCommands } from "../../src/commands/sips/index.js";
import { createImagemagickCommands } from "../../src/commands/imagemagick/index.js";
import { createPdfimagesCommands } from "../../src/commands/pdfimages/index.js";
import { encodePng } from "@poe-code/pdf-ast";
import { createQpdfCommands } from "../../src/commands/qpdf/index.js";
import { createPdftkCommands } from "../../src/commands/pdftk/index.js";
import { createPdfinfoCommands } from "../../src/commands/pdfinfo/index.js";
import { createPdftotextCommands } from "../../src/commands/pdftotext/index.js";
import { createExiftoolCommands } from "../../src/commands/exiftool/index.js";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCompressionCommands } from "../../src/commands/bytes/compression/index.js";
import { createGpgCommands } from "../../src/commands/gpg/index.js";
import { createSshCommands } from "../../src/commands/ssh/index.js";
import { createOpensslCommands } from "../../src/commands/openssl/index.js";
import { createSqlite3Commands } from "../../src/commands/sqlite3/index.js";
import { createDdCommands } from "../../src/commands/dd/index.js";
import { createCsvkitCommands } from "../../src/commands/csvkit/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Runtime } from "../../src/shell/runtime.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";
import { createXmllintCommands, evalSyncXmllint } from "../../src/commands/xml/index.js";
import { createUnrtfCommands } from "../../src/commands/unrtf/index.js";
import { createPrCommands } from "../../src/commands/pr/index.js";
import { createPathchkCommands } from "../../src/commands/pathchk/index.js";
import { createFileCommands } from "../../src/commands/file/index.js";
import { createDiff3Commands } from "../../src/commands/diff3/index.js";
import { createWhichCommands } from "../../src/commands/which/index.js";
import { createDiffPatchCommands } from "../../src/commands/diff-patch/index.js";
import { createXanCommands } from "../../src/commands/xan/index.js";
import { createTimeEnvCommands } from "../../src/commands/time-env/index.js";
import { createLessCommands } from "../../src/commands/less/index.js";
import { createGrepAliasCommands } from "../../src/commands/grep-aliases/index.js";
import { createDfCommands } from "../../src/commands/df/index.js";
import { createDuCommands } from "../../src/commands/du/index.js";
import { createTreeCommands } from "../../src/commands/tree/index.js";
import { createMetadataCommands } from "../../src/commands/metadata/index.js";
import { createFdCommands } from "../../src/commands/fd/index.js";
import { createSearchCommands } from "../../src/commands/search/index.js";

const parityXml = new TextEncoder().encode('<config><server id="main"><host>local&#13;host</host><?pi target="1"?><?empty?></server><server id="backup"><host>replica</host></server></config>');

for (const path of ["/config server/host", "/config/server/@id/host", "/config/server/text()/host"]) {
  for (const query of [path, `count(${path})`, `string(${path})`, `boolean(${path})`]) {
    test(`xmllint rejects invalid XPath in sync substitutions: ${query}`, async () => {
      assert.equal(evalSyncXmllint(parityXml, ["--xpath", query]), undefined);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/config.xml", parityXml);
      const shell = new Shell({ fs, commands: new CommandRegistry([...createStandardCommands(), ...createXmllintCommands()]) });
      try {
        const direct = await shell.exec(`xmllint --xpath "${query}" /config.xml`);
        const substitution = await shell.exec(`value="$(xmllint --xpath "${query}" /config.xml)"`);
        assert.equal(direct.exitCode, 10);
        assert.equal(substitution.exitCode, direct.exitCode);
        assert.equal(substitution.stderr, direct.stderr);
        assert.equal(substitution.stdout, "");
      } finally { await shell.dispose(); }
    });
  }
}

test("xmllint sync serialization preserves processing instructions and carriage returns", async () => {
  const query = "/config/server[@id='main']";
  const expected = '<server id="main"><host>local&#13;host</host><?pi target="1"?><?empty?></server>\n';
  assert.equal(evalSyncXmllint(parityXml, ["--xpath", query]), expected);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/config.xml", parityXml);
  const shell = new Shell({ fs, commands: new CommandRegistry([...createStandardCommands(), ...createXmllintCommands()]) });
  try {
    const direct = await shell.exec(`xmllint --xpath "${query}" /config.xml`);
    const substitution = await shell.exec(`value="$(xmllint --xpath "${query}" /config.xml)"; printf '%s\\n' "$value"`);
    assert.equal(direct.stdout, expected);
    assert.deepEqual(substitution, direct);
    assert.equal(evalSyncXmllint(parityXml, ["--xpath", "/config/server/host"]), '<host>local&#13;host</host>\n<host>replica</host>\n');
  } finally { await shell.dispose(); }
});

for (const [setup, substitution, value] of [
  ['a=hello;', 'echo "x${a@U}"', 'xHELLO'],
  ['a=HELLO;', 'echo "${a@L}"', 'hello'],
  ['a=hello;', 'echo "${a@u}"', 'Hello'],
  ['a=hello;', 'echo "${a@Q}"', "'hello'"],
  ['prefix_one=1;', 'echo "x${!prefix_*}"', 'xprefix_one'],
  ['', 'echo "x$(echo y)"', 'xy'],
  ['a=hello;', 'printf "%s" "${a@U}"', 'HELLO'],
  ['a=HELLO;', 'dirname -- "/tmp/${a@L}/b"', '/tmp/hello'],
  ['a=HELLO;', 'basename -- "/tmp/${a@L}"', 'hello'],
  ['a=hello; f() { echo "$1"; };', 'f "${a@U}"', 'HELLO'],
] as const) {
  for (const mode of ['echo', 'assign', 'append'] as const) {
    test(`loop substitution ${mode}: ${substitution}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
      const body = mode === 'echo' ? `echo "$(${substitution})"` : `out${mode === 'append' ? '+' : ''}=$(${substitution})`;
      try {
        const result = await shell.exec(`${setup} out=; for i in 1 2; do ${body}; done; ${mode === 'echo' ? '' : 'printf "%s\\n" "$out"; declare -p out >/dev/null'}`);
        assert.equal(result.stdout, mode === 'echo' ? `${value}\n${value}\n` : `${mode === 'append' ? value + value : value}\n`);
        assert.equal(result.stderr, '');
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}

for (const initialCommands of [124, 125, 126, 127]) {
  test(`loop substitutions cross yield checkpoints from command ${initialCommands}`, async context => {
    let checkpoints = 0;
    const runUnit = Runtime.prototype.runUnit;
    context.mock.method(Runtime.prototype, "runUnit", function (this: Runtime, ...args: Parameters<Runtime["runUnit"]>) {
      this.budget.commands = initialCommands;
      registerYieldCheckpoint(this.signal, () => { checkpoints++; });
      return runUnit.apply(this, args);
    });
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec('for i in {1..300}; do :; echo "$(echo "x$i")"; done');
      assert.equal(result.stdout, Array.from({ length: 300 }, (_, i) => `x${i + 1}\n`).join(''));
      assert.equal(result.stderr, '');
      assert.equal(result.exitCode, 0);
      assert.ok(checkpoints > 0);
    } finally { await shell.dispose(); }
  });
}

for (const loop of [
  'for ((i=0; i<2; i++)); do',
  'i=0; while ((i++ < 2)); do',
  'i=0; until ((i++ >= 2)); do',
  'for i in 1 2; do',
]) {
  test(`substitution preserves effects and mutable operands: ${loop}`, async () => {
    const source = `a=hello; out=; n=0; ${loop} n=$((n+1)); a="$a$i"; out+=$(echo "x$(echo "$a")"); echo "$(echo "x$(echo "$i")")"; done; printf "%s:%s\\n" "$n" "$out"; declare -p out`;
    const expected = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
    assert.equal(expected.error, undefined);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const actual = await shell.exec(source);
      assert.equal(actual.stdout, expected.stdout);
      assert.equal(actual.stderr, expected.stderr);
      assert.equal(actual.exitCode, expected.status);
    } finally { await shell.dispose(); }
  });
}

test("Wave 125: sync factor, tsort, envsubst, hexdump -C, column -t, fold, expand, and unexpand in seq loops", async () => {
  const { factorCommands } = await import("../../src/commands/factor/index.js");
  const { tsortCommands } = await import("../../src/commands/tsort/index.js");
  const { envsubstCommands } = await import("../../src/commands/envsubst/index.js");
  const { hexdumpCommands } = await import("../../src/commands/hexdump/index.js");
  const { columnCommands } = await import("../../src/commands/column/index.js");
  const { foldCommands } = await import("../../src/commands/fold/index.js");
  const { standardCommands } = await import("../../src/commands/index.js");
  const shell = new Shell({ fs: new MemoryFileSystem() })
    .use(standardCommands())
    .use(factorCommands())
    .use(tsortCommands())
    .use(envsubstCommands())
    .use(hexdumpCommands())
    .use(columnCommands())
    .use(foldCommands());
  try {
    const rFactor = await shell.exec("for i in $(seq 10 15); do out=$(factor $((i * 12))); done; echo \"$out\"");
    assert.equal(rFactor.exitCode, 0);
    assert.equal(rFactor.stdout, "180: 2 2 3 3 5\n");

    const rFactorExp = await shell.exec("echo \"$(factor -h 720)\"");
    assert.equal(rFactorExp.exitCode, 0);
    assert.equal(rFactorExp.stdout, "720: 2^4 3^2 5\n");

    const rTsort = await shell.exec("for i in $(seq 1 5); do out=$(printf \"a b\\nb c\\nc d\\n\" | tsort | tr \"\\n\" \":\"); done; echo \"$out\"");
    assert.equal(rTsort.exitCode, 0);
    assert.equal(rTsort.stdout, "a:b:c:d:\n");

    const rEnvsubst = await shell.exec("export NAME=world ROLE=admin; for i in $(seq 1 5); do out=$(printf \"hello \\$NAME (\\$ROLE) #$i\" | envsubst); done; echo \"$out\"");
    assert.equal(rEnvsubst.exitCode, 0);
    assert.equal(rEnvsubst.stdout, "hello world (admin) #5\n");

    const rHexdump = await shell.exec("for i in $(seq 1 5); do out=$(printf \"abc$i\" | hexdump -C | head -n 1); done; echo \"$out\"");
    assert.equal(rHexdump.exitCode, 0);
    assert.equal(rHexdump.stdout, "00000000  61 62 63 35                                       |abc5|\n");

    const rColumn = await shell.exec("for i in $(seq 1 5); do out=$(printf \"id:val\\n$i:$((i*10))\\n\" | column -t -s : | tail -n 1); done; echo \"$out\"");
    assert.equal(rColumn.exitCode, 0);
    assert.equal(rColumn.stdout, "5   50\n");

    const rFold = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item%02d\\n\" \"$i\" | fold -w 4 | tr \"\\n\" \":\"); done; echo \"$out\"");
    assert.equal(rFold.exitCode, 0);
    assert.equal(rFold.stdout, "item:05:\n");
  } finally {
    await shell.dispose();
  }
});

test("Wave 126: sync fmt, uname, id, whoami, hostname, and nproc in seq loops", async () => {
  const { standardCommands } = await import("../../src/commands/index.js");
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  try {
    const rUname = await shell.exec("for i in $(seq 1 5); do out=\"$(uname -s)-$(uname -m)-$i\"; done; echo \"$out\"");
    assert.equal(rUname.exitCode, 0);
    assert.equal(rUname.stdout, "Linux-x86_64-5\n");

    const rIdWhoami = await shell.exec("for i in $(seq 1 5); do out=\"$(id -u):$(whoami):$i\"; done; echo \"$out\"");
    assert.equal(rIdWhoami.exitCode, 0);
    assert.equal(rIdWhoami.stdout, "1000:sandbox:5\n");

    const rHostNproc = await shell.exec("for i in $(seq 1 5); do out=\"$(hostname):$(nproc):$i\"; done; echo \"$out\"");
    assert.equal(rHostNproc.exitCode, 0);
    assert.equal(rHostNproc.stdout, "sandbox:4:5\n");

    const rFmt = await shell.exec("for i in $(seq 1 5); do out=$(printf \"hello world $i foo bar\\n\" | fmt -w 12 | tr \"\\n\" \"|\"); done; echo \"$out\"");
    assert.equal(rFmt.exitCode, 0);
    assert.equal(rFmt.stdout, "hello world|5 foo bar|\n");
  } finally {
    await shell.dispose();
  }
});

test("Wave 127: sync sha256sum, md5sum, sha1sum, sha512sum, cksum, and base32 in seq loops", async () => {
  const { standardCommands } = await import("../../src/commands/index.js");
  const { byteCommands } = await import("../../src/commands/bytes/index.js");
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(byteCommands());
  try {
    const rSha256 = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item-$i\" | sha256sum | cut -d\" \" -f1); done; echo \"$out\"");
    assert.equal(rSha256.exitCode, 0);
    assert.equal(rSha256.stdout, "fd9c86032838eb5e65d0f4ad6eb3af2d114ed16f4b729043cab3e2b7483decc9\n");

    const rMd5 = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item-$i\" | md5sum | cut -d\" \" -f1); done; echo \"$out\"");
    assert.equal(rMd5.exitCode, 0);
    assert.equal(rMd5.stdout, "ad36abff56ce76a479dda134a3744c3b\n");

    const rSha1 = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item-$i\" | sha1sum | cut -d\" \" -f1); done; echo \"$out\"");
    assert.equal(rSha1.exitCode, 0);
    assert.equal(rSha1.stdout, "daf0ac810772422088dbb6b77b3b29a64028b5b9\n");

    const rSha512 = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item-$i\" | sha512sum | cut -d\" \" -f1); done; echo \"$out\"");
    assert.equal(rSha512.exitCode, 0);
    assert.equal(rSha512.stdout, "3552d85db804d10a0cdb2b4c32784798bd9b83ae77f43c83b6d74195a983b25990038dffc7670a82fb676697539e3e7fa68d774db36f5057ce0c8a22a769216d\n");

    const rCksum = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item-$i\" | cksum); done; echo \"$out\"");
    assert.equal(rCksum.exitCode, 0);
    assert.equal(rCksum.stdout, "2112230944 6\n");

    const rBase32 = await shell.exec("for i in $(seq 1 5); do out=$(printf \"item-$i\" | base32 | base32 -d); done; echo \"$out\"");
    assert.equal(rBase32.exitCode, 0);
    assert.equal(rBase32.stdout, "item-5\n");
  } finally {
    await shell.dispose();
  }
});

test("Wave 128: sync getconf, locale, csvcut, and csvgrep substitutions and pipelines", async () => {
  const { createGetconfCommands } = await import("../../src/commands/getconf/index.js");
  const { createLocaleCommands } = await import("../../src/commands/locale/index.js");
  const { createCsvcutCommands } = await import("../../src/commands/csvcut/index.js");
  const { createCsvgrepCommands } = await import("../../src/commands/csvgrep/index.js");
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  await fs.writeFile(
    "/tmp/users.csv",
    new TextEncoder().encode("id,name,role,score\n1,alice,admin,98\n2,bob,user,75\n3,carol,admin,91\n4,dave,user,84\n")
  );
  const commands = new CommandRegistry([
    ...createStandardCommands(),
    ...createGetconfCommands(),
    ...createLocaleCommands(),
    ...createCsvcutCommands(),
    ...createCsvgrepCommands(),
  ]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(getconf PAGE_SIZE):$(getconf _NPROCESSORS_ONLN):$(locale charmap):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "4096:4:UTF-8:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(csvgrep -c role -m admin /tmp/users.csv | csvcut -c name,score | tail -n 1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "carol,91:80\n");
});

test("Wave 129: sync getopt, dos2unix, unix2dos, and iconv substitutions and pipelines", async () => {
  const { createGetoptCommands } = await import("../../src/commands/getopt/index.js");
  const { createDos2unixCommands } = await import("../../src/commands/line-endings/index.js");
  const { createIconvCommands } = await import("../../src/commands/iconv/index.js");
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  await fs.writeFile("/tmp/crlf.txt", new TextEncoder().encode("alpha\r\nbeta\r\ngamma\r\n"));
  const commands = new CommandRegistry([
    ...createStandardCommands(),
    ...createGetoptCommands(),
    ...createDos2unixCommands(),
    ...createIconvCommands(),
  ]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(getopt -o ab:c --long alpha,beta: -- -a -b val --alpha pos1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, " -a -b 'val' --alpha -- 'pos1':80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(dos2unix -O /tmp/crlf.txt | unix2dos | dos2unix | tail -n 1):$(printf "café-%s\n" "$i" | iconv -f UTF-8 -t ASCII//IGNORE)"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "gamma:caf-80\n");
});

test("Wave 130: sync htmlq, cal, and ncal substitutions and pipelines", async () => {
  const { createHtmlqCommands } = await import("../../src/commands/htmlq/index.js");
  const { createCalCommands } = await import("../../src/commands/cal/index.js");
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  await fs.writeFile(
    "/tmp/page.html",
    new TextEncoder().encode("<html><body><ul id=\"items\"><li class=\"active\" data-id=\"42\">First</li><li>Second</li></ul></body></html>")
  );
  const commands = new CommandRegistry([
    ...createStandardCommands(),
    ...createHtmlqCommands(),
    ...createCalCommands(),
  ]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(htmlq --text "li.active" -f /tmp/page.html):$(htmlq -a data-id "li.active" -f /tmp/page.html):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "First:42:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(cal 2 2024 | head -n 1):$(ncal 2 2024 | head -n 1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "   February 2024      :    February 2024     :80\n");
});

test("Wave 131: sync yes | head pipelines and xmllint --xpath substitutions", async () => {
  const { createYesCommands } = await import("../../src/commands/yes/index.js");
  const { createXmllintCommands } = await import("../../src/commands/xml/index.js");
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  await fs.writeFile(
    "/tmp/config.xml",
    new TextEncoder().encode("<config><server id=\"main\" port=\"8080\"><host>localhost</host></server><server id=\"backup\" port=\"8081\"><host>replica</host></server></config>")
  );
  const commands = new CommandRegistry([
    ...createStandardCommands(),
    ...createYesCommands(),
    ...createXmllintCommands(),
  ]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(yes "ok" | head -n 4 | tr "\n" "-"):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "ok-ok-ok-ok-:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(xmllint --xpath "string(/config/server[@id='main']/host)" /tmp/config.xml):$(xmllint --xpath "count(//server)" /tmp/config.xml):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "localhost:2:80\n");
});

test("Wave 132: sync xq and yq substitutions and pipelines", async () => {
  const { createXmlCommands } = await import("../../src/commands/xml/index.js");
  const { createYqCommands } = await import("../../src/commands/yq/index.js");
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  await fs.writeFile(
    "/tmp/pom.xml",
    new TextEncoder().encode("<project id=\"p1\"><name>safe-bash</name><version>1.2.0</version><deps><dep>a</dep><dep>b</dep></deps></project>\n")
  );
  await fs.writeFile(
    "/tmp/cfg.yaml",
    new TextEncoder().encode("app:\n  name: safe-bash\n  port: 8080\n  enabled: true\n")
  );
  await fs.writeFile(
    "/tmp/cfg.toml",
    new TextEncoder().encode("[server]\nhost = \"127.0.0.1\"\nport = 9000\n")
  );
  const commands = new CommandRegistry([
    ...createStandardCommands(),
    ...createXmlCommands(),
    ...createYqCommands(),
  ]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(xq -r ".project.name" /tmp/pom.xml):$(cat /tmp/pom.xml | xq -r ".project.deps.dep[1]"):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "safe-bash:b:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(yq ".app.name" /tmp/cfg.yaml):$(yq -p toml ".server.port" < /tmp/cfg.toml):$(cat /tmp/cfg.yaml | yq -o json -r ".app.port"):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, '"safe-bash":9000:8080:80\n');
});

test("Wave 133: sync mdq, shuf, and html-to-markdown substitutions and pipelines", async () => {
  const { createMdqCommands } = await import("../../src/commands/mdq/index.js");
  const { createHtmlToMarkdownCommands } = await import("../../src/commands/html-to-markdown/index.js");
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  await fs.writeFile(
    "/tmp/README.md",
    new TextEncoder().encode("# Project\n\nIntro paragraph.\n\n## Install\n\n```bash\nnpm install\n```\n\n## Features\n\n- Fast\n- Safe\n")
  );
  await fs.writeFile(
    "/tmp/doc.html",
    new TextEncoder().encode("<h1>Title</h1><p>Hello <strong>world</strong> with <code>code</code>.</p><ul><li>First</li><li>Second</li></ul>")
  );
  await fs.writeFile(
    "/tmp/seed.bin",
    new Uint8Array(256).map((_, i) => (i * 73 + 19) & 0xff)
  );
  const commands = new CommandRegistry([
    ...createStandardCommands(),
    ...createMdqCommands(),
    ...createHtmlToMarkdownCommands(),
  ]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(mdq -o plain '\`\`\`bash' /tmp/README.md):$(cat /tmp/README.md | mdq -o plain "# Features | -"):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "npm install:Fast\nSafe:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(shuf --random-source=/tmp/seed.bin -e a b c | tr "\n" ","):$(shuf -i 42-42 -n 1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "b,a,c,:42:80\n");

  const r3 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(html-to-markdown /tmp/doc.html | head -n 1):$(cat /tmp/doc.html | html-to-markdown | tail -n 1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r3.exitCode, 0);
  assert.equal(r3.stdout, "# Title:- Second:80\n");
});

test("sync substitution fast path covers unrtf, pr, and pathchk (Wave 134)", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/doc.rtf", new TextEncoder().encode("{\\rtf1\\ansi Hello {\\b World}\\par Second line}\n"));
  await fs.writeFile("/items.txt", new TextEncoder().encode("alpha\nbeta\ngamma\ndelta\n"));
  const commands = new CommandRegistry([
    ...createStandardCommands(),
    ...createUnrtfCommands(),
    ...createPrCommands(),
    ...createPathchkCommands(),
  ]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(unrtf --text /doc.rtf | head -n 1):$(cat /doc.rtf | unrtf --html):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "Hello World:<!DOCTYPE html><html><body><p>Hello <strong>World</strong></p><p>Second line</p></body></html>:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(pr -t -2 -s: /items.txt | head -n 1):$(printf "1\n2\n3\n4\n" | pr -t -2 -s, | tail -n 1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "alpha:gamma:2,4:80\n");

  const r3 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(pathchk -p /items.txt valid_1.txt):$(pathchk --portability /items.txt):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r3.exitCode, 0);
  assert.equal(r3.stdout, "::80\n");
});

test("sync substitution fast path covers file, diff3, and cmp (Wave 135)", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/script.sh", new TextEncoder().encode("#!/bin/sh\necho hello\n"));
  await fs.writeFile("/data.json", new TextEncoder().encode("{\"a\":1}\n"));
  await fs.writeFile("/base.txt", new TextEncoder().encode("line1\nline2\nline3\n"));
  await fs.writeFile("/mine.txt", new TextEncoder().encode("line1\nline2\nline3\n"));
  await fs.writeFile("/yours.txt", new TextEncoder().encode("line1\nline2-mod\nline3\n"));
  const commands = new CommandRegistry([
    ...createStandardCommands(),
    ...createFileCommands(),
    ...createDiff3Commands(),
  ]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(file -b --mime-type /script.sh):$(cat /data.json | file -b --mime-type -):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "text/x-shellscript:application/json:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(diff3 -m /mine.txt /base.txt /yours.txt | head -n 2 | tail -n 1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "line2-mod:80\n");

  const r3 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(cmp /base.txt /mine.txt):$(cmp -n 5 /base.txt /yours.txt):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r3.exitCode, 0);
  assert.equal(r3.stdout, "::80\n");
});

test("sync substitution fast path covers which, diff, and xan (Wave 136)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/usr/bin", { recursive: true });
  await fs.writeFile("/usr/bin/mytool", new TextEncoder().encode("#!/bin/sh\n"));
  await fs.chmod("/usr/bin/mytool", 0o755);
  await fs.writeFile("/a.txt", new TextEncoder().encode("alpha\nbeta\n"));
  await fs.writeFile("/b.txt", new TextEncoder().encode("alpha\nbeta\n"));
  await fs.writeFile("/c.txt", new TextEncoder().encode("ALPHA\nBETA  \n"));
  await fs.writeFile("/data.csv", new TextEncoder().encode("id,name,score\n1,Alice,95\n2,Bob,88\n"));
  const commands = new CommandRegistry([
    ...createStandardCommands(),
    ...createWhichCommands(),
    ...createDiffPatchCommands(),
    ...createXanCommands(),
  ]);
  const shell = new Shell({ fs, commands, env: { PATH: "/bin:/usr/bin" } });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(which mytool):$(which -s mytool):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "/usr/bin/mytool::80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(diff -s /a.txt /b.txt):$(diff -i -w /a.txt /c.txt):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "Files /a.txt and /b.txt are identical::80\n");

  const r3 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(xan count /data.csv):$(cat /data.csv | xan headers -j - | tr "\n" ","):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r3.exitCode, 0);
  assert.equal(r3.stdout, "2:id,name,score,:80\n");
});

test("sync substitution fast path covers date, printenv, less, more, egrep, and fgrep (Wave 137)", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/notes.txt", new TextEncoder().encode("one\n\n\ntwo\nthree\n"));
  const commands = new CommandRegistry([
    ...createStandardCommands(),
    ...createTimeEnvCommands({ clock: () => 1700000000000 }),
    ...createLessCommands(),
    ...createGrepAliasCommands(),
  ]);
  const shell = new Shell({ fs, commands, env: { APP_MODE: "prod" } });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(date -u +%Y-%m-%d):$(printenv APP_MODE):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "2023-11-14:prod:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(less -s /notes.txt | tr "\n" ","):$(cat /notes.txt | more +4):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "one,,two,three,:two\nthree:80\n");

  const r3 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(egrep "^t(wo|hree)$" /notes.txt | tr "\n" ","):$(fgrep "one" /notes.txt):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r3.exitCode, 0);
  assert.equal(r3.stdout, "two,three,:one:80\n");
});

test("sync substitution fast path covers df, du, and tree (Wave 138)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/proj/src", { recursive: true });
  await fs.writeFile("/proj/README.md", new TextEncoder().encode("hello\n"));
  await fs.writeFile("/proj/src/index.ts", new TextEncoder().encode("export const x = 1;\n"));
  const commands = new CommandRegistry([
    ...createStandardCommands(),
    ...createDfCommands(),
    ...createDuCommands(),
    ...createTreeCommands(),
  ]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(df --output=source,target /proj | tail -n 1 | tr -s " "):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "sandbox-vfs /:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(du -sb /proj | cut -f1):$(du -s --inodes /proj | cut -f1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "26:4:80\n");

  const r3 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(tree -i --noreport /proj | tr "\n" ","):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r3.exitCode, 0);
  assert.equal(r3.stdout, "/proj,README.md,src,index.ts,:80\n");
});

test("sync substitution fast path covers stat, fd, and rg (Wave 139)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo/src", { recursive: true });
  await fs.writeFile("/repo/README.md", new TextEncoder().encode("# Title\nhello world\n"));
  await fs.writeFile("/repo/src/app.ts", new TextEncoder().encode("export const port = 8080;\n"));
  const commands = new CommandRegistry([
    ...createStandardCommands(),
    ...createMetadataCommands(),
    ...createFdCommands(),
    ...createSearchCommands(),
  ]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(stat -c "%s:%F" /repo/README.md):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "20:regular file:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(fd -e ts . /repo):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "/repo/src/app.ts:80\n");

  const r3 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(rg -n "port" /repo/src/app.ts):$(cat /repo/README.md | rg -c "hello"):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r3.exitCode, 0);
  assert.equal(r3.stdout, "1:export const port = 8080;:1:80\n");
});

test("sync substitution fast path covers readlink, realpath, and ls (Wave 140)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/opt/app/bin", { recursive: true });
  await fs.writeFile("/opt/app/bin/run", new TextEncoder().encode("#!/bin/sh\n"));
  await fs.chmod("/opt/app/bin/run", 0o755);
  await fs.symlink("/opt/app/bin/run", "/opt/app/current");
  const commands = new CommandRegistry([...createStandardCommands()]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(readlink /opt/app/current):$(readlink -f /opt/app/current):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "/opt/app/bin/run:/opt/app/bin/run:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(realpath --relative-to=/opt/app /opt/app/current):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "bin/run:80\n");

  const r3 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(ls -F /opt/app | tr "\n" ","):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r3.exitCode, 0);
  assert.equal(r3.stdout, "bin/,current@,:80\n");
});


test("sync substitution and pipeline: find, csvlook, and csvjson (Wave 141)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/proj/src/sub", { recursive: true });
  const enc = new TextEncoder();
  await fs.writeFile("/proj/src/a.ts", enc.encode("export const a = 1;\n"));
  await fs.writeFile("/proj/src/sub/b.ts", enc.encode("export const b = 2;\n"));
  await fs.writeFile("/proj/src/readme.md", enc.encode("# Readme\n"));
  await fs.writeFile("/proj/data.csv", enc.encode("name,score\nalice,10\nbob,25\n"));
  const commands = new CommandRegistry([...createStandardCommands(), ...createCsvkitCommands()]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(find /proj/src -maxdepth 2 -type f -name '*.ts' | tr '\n' ','):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "/proj/src/a.ts,/proj/src/sub/b.ts,:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(csvlook /proj/data.csv | wc -l):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "4:80\n");

  const r3 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(csvjson --stream /proj/data.csv | head -n 1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r3.exitCode, 0);
  assert.equal(r3.stdout, "{\"name\": \"alice\", \"score\": 10.0}:80\n");
});


test("sync substitution and pipeline: csvsort, csvformat, and csvstat (Wave 142)", async () => {
  const fs = new MemoryFileSystem();
  const enc = new TextEncoder();
  await fs.mkdir("/proj", { recursive: true });
  await fs.writeFile("/proj/scores.csv", enc.encode("name,score\nbob,25\nalice,10\ncharlie,18\n"));
  const commands = new CommandRegistry([...createStandardCommands(), ...createCsvkitCommands()]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(csvsort -c score -r /proj/scores.csv | head -n 2 | tail -n 1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "bob,25:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(csvformat -D '|' -E /proj/scores.csv | head -n 1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "bob|25:80\n");

  const r3 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(csvstat --count /proj/scores.csv):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r3.exitCode, 0);
  assert.equal(r3.stdout, "3:80\n");
});


test("sync substitution and pipeline: in2csv, csvstack, and csvjoin (Wave 143)", async () => {
  const fs = new MemoryFileSystem();
  const enc = new TextEncoder();
  await fs.mkdir("/proj", { recursive: true });
  await fs.writeFile("/proj/items.json", enc.encode("[{\"id\": 1, \"name\": \"alpha\"}, {\"id\": 2, \"name\": \"beta\"}]\n"));
  await fs.writeFile("/proj/left.csv", enc.encode("id,name\n1,alpha\n2,beta\n"));
  await fs.writeFile("/proj/right.csv", enc.encode("id,price\n1,100\n2,200\n"));
  const commands = new CommandRegistry([...createStandardCommands(), ...createCsvkitCommands()]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(in2csv /proj/items.json | tail -n 1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "2,beta:80\n");

  const r2 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(csvstack -g g1,g2 /proj/left.csv /proj/left.csv | tail -n 1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "g2,2,beta:80\n");

  const r3 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(csvjoin -c id /proj/left.csv /proj/right.csv | tail -n 1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r3.exitCode, 0);
  assert.equal(r3.stdout, "2,beta,200:80\n");
});


test("sync substitution and pipeline: dd, env, and xargs (Wave 144)", async () => {
  const fs = new MemoryFileSystem();
  const enc = new TextEncoder();
  await fs.mkdir("/proj", { recursive: true });
  await fs.writeFile("/proj/msg.txt", enc.encode("hello world\n"));
  await fs.writeFile("/proj/list.txt", enc.encode("alpha\nbeta\ngamma\n"));
  const commands = new CommandRegistry([...createStandardCommands(), ...createDdCommands()]);
  const shell = new Shell({ fs, commands });

  const r1 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(dd if=/proj/msg.txt bs=1 skip=6 count=5 conv=ucase status=none):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r1.exitCode, 0);
  assert.equal(r1.stdout, "WORLD:80\n");

  const r2 = await shell.exec(`
    export BASE_ENV=prod
    out=""
    for i in $(seq 1 80); do
      out="$(env -i APP=demo MODE=fast printenv APP MODE | tr '\n' ','):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.stdout, "demo,fast,:80\n");

  const r3 = await shell.exec(`
    out=""
    for i in $(seq 1 80); do
      out="$(cat /proj/list.txt | xargs -I {} echo "item={}" | tail -n 1):$i"
    done
    printf "%s\n" "$out"
  `);
  assert.equal(r3.exitCode, 0);
  assert.equal(r3.stdout, "item=gamma:80\n");
});

test("Wave 145: sync openssl and sqlite3 substitutions and pipelines", async () => {
  const fs = new MemoryFileSystem();
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createOpensslCommands(),
    ...createSqlite3Commands(),
  ]) {
    registry.register(cmd);
  }
  const shell = new Shell({ fs, commands: registry });

  await shell.exec('printf "alpha\n" > /msg.txt; printf "id,name\n1,alice\n2,bob\n" > /users.csv');
  await shell.exec("sqlite3 /app.db \"CREATE TABLE items(id INT, name TEXT); INSERT INTO items VALUES(1, 'alpha'), (2, 'beta');\"");

  const t0 = performance.now();
  const r1 = await shell.exec('for i in $(seq 1 150); do out=$(openssl dgst -sha256 -r /msg.txt); done; printf "%s" "$out"');
  const r2 = await shell.exec('for i in $(seq 1 150); do out=$(printf "hello" | openssl dgst -sha256 -hmac secret); done; printf "%s" "$out"');
  const r3 = await shell.exec('for i in $(seq 1 150); do out=$(sqlite3 -csv :memory: ".import /users.csv u" "SELECT name FROM u WHERE id = 2;"); done; printf "%s" "$out"');
  const r4 = await shell.exec('for i in $(seq 1 150); do out=$(sqlite3 -json /app.db "SELECT id, name FROM items WHERE id = 2;"); done; printf "%s" "$out"');
  const elapsed = performance.now() - t0;

  assert.equal(r1.stdout, "b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060 */msg.txt");
  assert.equal(r2.stdout, "HMAC-SHA2-256(stdin)= 88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b");
  assert.equal(r3.stdout, "bob");
  assert.equal(r4.stdout, '[{"id":2,"name":"beta"}]');
  assert.ok(elapsed < 800, `Expected < 800ms for 4x150 iterations, took ${elapsed.toFixed(1)}ms`);
});

test("Wave 146: sync gpg, ssh, and ssh-keygen substitutions and pipelines", async () => {
  const fs = new MemoryFileSystem();
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createGpgCommands(),
    ...createSshCommands(),
  ]) {
    registry.register(cmd);
  }
  const shell = new Shell({ fs, commands: registry });

  await shell.exec('gpg --quick-generate-key "Alice <alice@example.com>" && ssh-keygen -t ed25519 -C "alice@host" -f /home/user/.ssh/id_ed25519');

  const t0 = performance.now();
  const r1 = await shell.exec('for i in $(seq 1 150); do out=$(gpg --list-keys); done; printf "%s" "$out"');
  const r2 = await shell.exec('for i in $(seq 1 150); do out=$(ssh -G -p 2222 deploy@prod.example.com); done; printf "%s" "$out"');
  const r3 = await shell.exec('for i in $(seq 1 150); do out=$(ssh-keygen -l -f /home/user/.ssh/id_ed25519.pub); done; printf "%s" "$out"');
  const elapsed = performance.now() - t0;

  assert.match(r1.stdout, /Alice <alice@example.com>/);
  assert.equal(r2.stdout, "user deploy\nhostname prod.example.com\nport 2222\nidentityfile /home/user/.ssh/id_ed25519");
  assert.match(r3.stdout, /^256 SHA256:[A-Za-z0-9+/]+ alice@host \(ED25519\)$/);
  assert.ok(elapsed < 800, `Expected < 800ms for 3x150 iterations, took ${elapsed.toFixed(1)}ms`);
});

test("Wave 147: sync gzip, gunzip, zcat, unzstd, and zstdcat substitutions and pipelines", async () => {
  const fs = new MemoryFileSystem();
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createCompressionCommands(),
  ]) {
    registry.register(cmd);
  }
  const shell = new Shell({ fs, commands: registry });

  await shell.exec('printf "alpha-beta-gamma\n" | gzip > /data.gz; printf "delta-epsilon-zeta\n" | zstd > /data.zst');

  const t0 = performance.now();
  const r1 = await shell.exec('for i in $(seq 1 150); do out=$(printf "roundtrip-test\n" | gzip | gunzip); done; printf "%s" "$out"');
  const r2 = await shell.exec('for i in $(seq 1 150); do out=$(zcat /data.gz); done; printf "%s" "$out"');
  const r3 = await shell.exec('for i in $(seq 1 150); do out=$(zstdcat /data.zst); done; printf "%s" "$out"');
  const elapsed = performance.now() - t0;

  assert.equal(r1.stdout, "roundtrip-test");
  assert.equal(r2.stdout, "alpha-beta-gamma");
  assert.equal(r3.stdout, "delta-epsilon-zeta");
  assert.ok(elapsed < 800, `Expected < 800ms for 3x150 iterations, took ${elapsed.toFixed(1)}ms`);
});

test("Wave 148: sync pdfinfo, pdftotext, and exiftool substitutions and pipelines", async () => {
  const fs = new MemoryFileSystem();
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createPdfinfoCommands(),
    ...createPdftotextCommands(),
    ...createExiftoolCommands(),
  ]) {
    registry.register(cmd);
  }
  const shell = new Shell({ fs, commands: registry });

  const doc = PdfDocument.create();
  doc.setTitle("Test Doc");
  doc.setAuthor("Alice");
  const page = doc.addPage([612, 792]);
  page.drawText("Hello from PDF page one", { x: 72, y: 700, size: 12 });
  await fs.writeFile("/sample.pdf", doc.save());

  const t0 = performance.now();
  const r1 = await shell.exec('for i in $(seq 1 150); do out=$(pdfinfo /sample.pdf); done; printf "%s" "$out"');
  const r2 = await shell.exec('for i in $(seq 1 150); do out=$(pdftotext /sample.pdf -); done; printf "%s" "$out"');
  const r3 = await shell.exec('for i in $(seq 1 150); do out=$(exiftool -s -s -s -Title /sample.pdf); done; printf "%s" "$out"');
  const elapsed = performance.now() - t0;

  assert.match(r1.stdout, /^Title:\s+Test Doc/m);
  assert.equal(r2.stdout, "Hello from PDF page one\n\n\f");
  assert.equal(r3.stdout, "Test Doc");
  assert.ok(elapsed < 1500, `Expected < 1500ms for 3x150 iterations, took ${elapsed.toFixed(1)}ms`);
});

test("Wave 149: sync pdffonts, pdftohtml, qpdf, and pdftk substitutions and pipelines", async () => {
  const fs = new MemoryFileSystem();
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createPdfinfoCommands(),
    ...createPdftotextCommands(),
    ...createQpdfCommands(),
    ...createPdftkCommands(),
  ]) {
    registry.register(cmd);
  }
  const shell = new Shell({ fs, commands: registry });

  const doc = PdfDocument.create();
  doc.setTitle("Test Doc");
  doc.setAuthor("Alice");
  const page = doc.addPage([612, 792]);
  page.drawText("Hello from PDF page one", { x: 72, y: 700, size: 12 });
  await fs.writeFile("/sample.pdf", doc.save());

  const t0 = performance.now();
  const r1 = await shell.exec('for i in $(seq 1 150); do out=$(pdffonts /sample.pdf); done; printf "%s" "$out"');
  const r2 = await shell.exec('for i in $(seq 1 150); do out=$(pdftohtml -stdout /sample.pdf); done; printf "%s" "$out"');
  const r3 = await shell.exec('for i in $(seq 1 150); do out=$(qpdf --show-npages /sample.pdf); done; printf "%s" "$out"');
  const r4 = await shell.exec('for i in $(seq 1 150); do out=$(pdftk /sample.pdf dump_data); done; printf "%s" "$out"');
  const elapsed = performance.now() - t0;

  assert.match(r1.stdout, /Helvetica/);
  assert.match(r2.stdout, /Hello from PDF page one/);
  assert.equal(r3.stdout, "1");
  assert.match(r4.stdout, /NumberOfPages: 1/);
  assert.ok(elapsed < 1000, `Expected < 1000ms for 4x150 iterations, took ${elapsed.toFixed(1)}ms`);
});

test("Wave 150: sync sips, identify, magick identify, and pdfimages substitutions and pipelines", async () => {
  const fs = new MemoryFileSystem();
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createSipsCommands(),
    ...createImagemagickCommands(),
    ...createPdfimagesCommands(),
  ]) {
    registry.register(cmd);
  }
  const shell = new Shell({ fs, commands: registry });

  const pngBytes = encodePng({ width: 16, height: 12, data: new Uint8Array(16 * 12 * 4) });
  await fs.writeFile("/icon.png", pngBytes);

  const doc = PdfDocument.create();
  doc.addPage([612, 792]);
  await fs.writeFile("/sample.pdf", doc.save());

  const t0 = performance.now();
  const r1 = await shell.exec('for i in $(seq 1 150); do out=$(sips -g pixelWidth -g pixelHeight /icon.png); done; printf "%s" "$out"');
  const r2 = await shell.exec('for i in $(seq 1 150); do out=$(identify -format "%wx%h %m" /icon.png); done; printf "%s" "$out"');
  const r3 = await shell.exec('for i in $(seq 1 150); do out=$(magick identify /icon.png); done; printf "%s" "$out"');
  const r4 = await shell.exec('for i in $(seq 1 150); do out=$(pdfimages -list /sample.pdf); done; printf "%s" "$out"');
  const elapsed = performance.now() - t0;

  assert.equal(r1.stdout, "/icon.png\n  pixelWidth: 16\n  pixelHeight: 12");
  assert.equal(r2.stdout, "16x12 PNG");
  assert.ok(r3.stdout.startsWith("/icon.png PNG 16x12 "));
  assert.ok(r4.stdout.startsWith("page"));
  assert.ok(elapsed < 1000, `Expected < 1000ms for 4x150 iterations, took ${elapsed.toFixed(1)}ms`);
});

test("Wave 151: sync pdfdetach, ffprobe, ffmpeg, and gh substitutions and pipelines", async () => {
  const fs = new MemoryFileSystem();
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createPdfinfoCommands(),
    ...createQpdfCommands(),
    ...createFfmpegCommands(),
    ...createGhCommands(),
  ]) {
    registry.register(cmd);
  }
  const shell = new Shell({ fs, commands: registry });

    await shell.exec("ffmpeg -f lavfi -i color=c=blue:s=16x16:d=1 -c:v libx264 /sample.mp4");
    const setupPdf = await shell.exec("qpdf --empty /empty.pdf");
    assert.equal(setupPdf.exitCode, 0);

    const t0 = performance.now();
    const rDetach = await shell.exec('for i in $(seq 1 150); do n=$(pdfdetach -list /empty.pdf | head -n 1); done; printf "%s" "$n"');
    const rProbe = await shell.exec('for i in $(seq 1 150); do fmt=$(ffprobe -v error -show_entries format=format_name -of default=noprint_wrappers=1:nokey=1 /sample.mp4); done; printf "%s" "$fmt"');
    const rFfmpeg = await shell.exec('for i in $(seq 1 150); do ver=$(ffmpeg -version | head -n 1); done; printf "%s" "$ver"');
    const rGh1 = await shell.exec('for i in $(seq 1 150); do proto=$(gh config get git_protocol); done; printf "%s" "$proto"');
    const rGh2 = await shell.exec('for i in $(seq 1 150); do repo=$(gh repo view octocat/Hello-World --json nameWithOwner); done; printf "%s" "$repo"');
    const elapsed = performance.now() - t0;

    assert.equal(rDetach.stdout, "0 embedded files");
    assert.match(rProbe.stdout, /mp4/);
    assert.match(rFfmpeg.stdout, /ffmpeg version/);
    assert.equal(rGh1.stdout, "https");
    assert.equal(rGh2.stdout, '{\n  "nameWithOwner": "octocat/Hello-World"\n}');
    assert.ok(elapsed < 1000, `Expected <1000ms for 5x150 iterations, got ${elapsed.toFixed(1)}ms`);
});


test("Wave 152: sync pdftoppm, pdftocairo, mmdc, and pandoc substitutions and pipelines", async () => {
  const fs = new MemoryFileSystem();
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createPdftoppmCommands(),
    ...createMmdcCommands(),
    ...createPandocCommands(),
  ]) {
    registry.register(cmd);
  }
  const shell = new Shell({ fs, commands: registry });

  const doc = PdfDocument.create();
  doc.addPage([612, 792]);
  await fs.writeFile("/sample.pdf", doc.save());
  await fs.writeFile("/diag.mmd", new TextEncoder().encode("flowchart LR\n  A[Start] --> B[End]\n"));

  const t0 = performance.now();
  const r1 = await shell.exec('for i in $(seq 1 150); do s=$(pdftoppm -svg /sample.pdf - | head -n 1); done; printf "%s" "$s"');
  const r2 = await shell.exec('for i in $(seq 1 150); do s=$(pdftocairo -svg /sample.pdf - | head -n 1); done; printf "%s" "$s"');
  const r3 = await shell.exec('for i in $(seq 1 150); do s=$(mmdc -i /diag.mmd -o - -e svg | head -n 1); done; printf "%s" "$s"');
  const r4 = await shell.exec('for i in $(seq 1 150); do s=$(pandoc --list-input-formats | head -n 1); done; printf "%s" "$s"');
  const elapsed = performance.now() - t0;

  assert.match(r1.stdout, /<svg/);
  assert.match(r2.stdout, /<svg/);
  assert.match(r3.stdout, /<svg/);
  assert.equal(r4.stdout, "commonmark");
  assert.ok(elapsed < 1000, `Expected <1000ms for 4x150 iterations, got ${elapsed.toFixed(1)}ms`);
});


test("Wave 153: sync soffice, libreoffice, ssconvert, wkhtmltopdf, and op substitutions and pipelines", async () => {
  const fs = new MemoryFileSystem();
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createSofficeCommands(),
    ...createSsconvertCommands(),
    ...createWkhtmltopdfCommands(),
    ...createOpCommands({ version: "2.30.0" }),
  ]) {
    registry.register(cmd);
  }
  const shell = new Shell({ fs, commands: registry });

  await fs.writeFile("/note.txt", new TextEncoder().encode("Hello LibreOffice Cat"));

  const t0 = performance.now();
  const r1 = await shell.exec('for i in $(seq 1 150); do s=$(soffice --cat /note.txt); done; printf "%s" "$s"');
  const r2 = await shell.exec('for i in $(seq 1 150); do s=$(libreoffice --version); done; printf "%s" "$s"');
  const r3 = await shell.exec('for i in $(seq 1 150); do s=$(ssconvert --version | head -n 1); done; printf "%s" "$s"');
  const r4 = await shell.exec('for i in $(seq 1 150); do s=$(wkhtmltopdf --version | head -n 1); done; printf "%s" "$s"');
  const r5 = await shell.exec('for i in $(seq 1 150); do s=$(op --version); done; printf "%s" "$s"');
  const elapsed = performance.now() - t0;

  assert.equal(r1.stdout, "Hello LibreOffice Cat");
  assert.match(r2.stdout, /LibreOffice 24\.8/);
  assert.match(r3.stdout, /ssconvert/);
  assert.match(r4.stdout, /wkhtmltopdf/);
  assert.equal(r5.stdout, "2.30.0");
  assert.ok(elapsed < 1000, `Expected <1000ms for 5x150 iterations, got ${elapsed.toFixed(1)}ms`);
});

test("sync substitution and pipeline fast path for git, tar, unzip, and zip (Wave 154)", async () => {
  const fs = new MemoryFileSystem();
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createGitCommands(),
    ...createArchiveCommands(),
  ]) {
    registry.register(cmd, { replace: true });
  }
  const shell = new Shell({ fs, commands: registry });

  // Prepare git repo, tar archive, and zip archive in VFS
  const setupRes = await shell.exec(`
    mkdir -p /repo
    cd /repo
    git init -b main
    git config user.name "Alice"
    git config user.email "alice@example.com"
    printf 'hello from git and archives\n' > /repo/hello.txt
    printf 'second member line\n' > /repo/second.txt
    git add hello.txt second.txt
    git commit -m "initial commit"
    tar -cf /archive.tar -C /repo hello.txt second.txt
    zip -q /archive.zip /repo/hello.txt /repo/second.txt
  `);
  assert.equal(setupRes.exitCode, 0, setupRes.stderr);

  const t0 = performance.now();
  const res = await shell.exec(`
    cd /repo
    g_ver=""
    g_branch=""
    g_log=""
    t_list=""
    t_ext=""
    u_names=""
    u_pipe=""
    z_ver=""
    for i in $(seq 1 150); do
      g_ver=$(git --version | head -n 1)
      g_branch=$(git rev-parse --abbrev-ref HEAD)
      g_log=$(git log -1 --oneline)
      t_list=$(tar -tf /archive.tar | head -n 1)
      t_ext=$(tar -xOf /archive.tar hello.txt)
      u_names=$(unzip -Z1 /archive.zip | head -n 1)
      u_pipe=$(unzip -p /archive.zip repo/hello.txt)
      z_ver=$(zip -v | head -n 1)
    done
    printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$g_ver" "$g_branch" "$g_log" "$t_list" "$t_ext" "$u_names" "$u_pipe" "$z_ver"
  `);
  const elapsed = performance.now() - t0;
  assert.equal(res.exitCode, 0, res.stderr);
  const lines = res.stdout.trim().split("\n");
  assert.match(lines[0] ?? "", /^git version /);
  assert.equal(lines[1], "main");
  assert.match(lines[2] ?? "", /initial commit/);
  assert.equal(lines[3], "hello.txt");
  assert.equal(lines[4], "hello from git and archives");
  assert.equal(lines[5], "repo/hello.txt");
  assert.equal(lines[6], "hello from git and archives");
  assert.match(lines[7] ?? "", /safe-bash zip/);
  assert.ok(elapsed < 2500, `Expected < 2500ms for 8x150 iterations, took ${elapsed.toFixed(1)}ms`);
});

test("timeout sync evaluator admits parsed durations and defers options requiring child validation", () => {
  assert.equal(evalSyncTimeout(["5s", "echo", "ready"]), "ready\n");
  for (const args of [
    ["invalid", "echo", "ready"], ["0", "echo", "ready"],
    ["-s", "invalid", "5", "echo", "ready"], ["--signal=invalid", "5", "echo", "ready"],
    ["-k", "invalid", "5", "echo", "ready"], ["--kill-after=invalid", "5", "echo", "ready"],
    ["5", "echo", "-n", "-n", "ready"]
  ]) assert.equal(evalSyncTimeout(args), undefined, args.join(" "));
});

test("timeout sync substitutions preserve child diagnostics and echo options", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createTimeoutCommands()]) });
  try {
    for (const args of ["0 echo ready", "-s invalid 5 echo ready", "--signal=invalid 5 echo ready", "-k invalid 5 echo ready", "--kill-after=invalid 5 echo ready", "5 echo -n -n ready"]) {
      const direct = await shell.exec(`timeout ${args}`);
      if (args === "0 echo ready") {
        assert.equal(direct.exitCode, 0);
        assert.equal(direct.stderr, "");
        assert.equal(direct.stdout, "ready\n");
      }
      const substitution = await shell.exec(`value="$(timeout ${args})"; status=$?; printf '%s' "$value"; exit "$status"`);
      assert.equal(substitution.exitCode, direct.exitCode, args);
      assert.equal(substitution.stderr, direct.stderr, args);
      assert.equal(substitution.stdout, direct.stdout.replace(/\n+$/u, ""), args);
    }
  } finally {
    await shell.dispose();
  }
});

test("sync substitution and pipeline fast path for bzip2, bunzip2, bzcat, xz, unxz, xzcat, zstd, and timeout (Wave 155)", async () => {
  const fs = new MemoryFileSystem();
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createCompressionCommands(),
    ...createTimeoutCommands(),
  ]) {
    registry.register(cmd, { replace: true });
  }
  const shell = new Shell({ fs, commands: registry });

  const setup = await shell.exec(`
    printf 'hello bzip2 payload\n' | bzip2 -c > /data.bz2
    printf 'hello xz payload\n' | xz -c > /data.xz
    printf 'hello zstd payload\n' | zstd -c > /data.zst
  `);
  assert.equal(setup.exitCode, 0, setup.stderr);

  const t0 = performance.now();
  const res = await shell.exec(`
    r_bzcat=""
    r_bzpipe=""
    r_xzcat=""
    r_xzpipe=""
    r_zstd=""
    r_tver=""
    r_techo=""
    for i in $(seq 1 150); do
      r_bzcat=$(bzcat /data.bz2)
      r_bzpipe=$(printf 'inline bz2\n' | bzip2 -c | bunzip2)
      r_xzcat=$(xzcat /data.xz)
      r_xzpipe=$(printf 'inline xz\n' | xz -c | unxz)
      r_zstd=$(printf 'inline zstd\n' | zstd -c | unzstd)
      r_tver=$(timeout --version | head -n 1)
      r_techo=$(timeout 5s echo "timed ok")
    done
    printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$r_bzcat" "$r_bzpipe" "$r_xzcat" "$r_xzpipe" "$r_zstd" "$r_tver" "$r_techo"
  `);
  const elapsed = performance.now() - t0;
  assert.equal(res.exitCode, 0, res.stderr);
  const lines = res.stdout.trim().split("\n");
  assert.equal(lines[0], "hello bzip2 payload");
  assert.equal(lines[1], "inline bz2");
  assert.equal(lines[2], "hello xz payload");
  assert.equal(lines[3], "inline xz");
  assert.equal(lines[4], "inline zstd");
  assert.match(lines[5] ?? "", /^timeout /);
  assert.equal(lines[6], "timed ok");
  assert.ok(elapsed < 1500, `Expected < 1500ms for 7x150 iterations, took ${elapsed.toFixed(1)}ms`);
});

test("sync substitution and pipeline fast path for split, csplit, curl, wget, and gnuInformationSync (Wave 156)", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile(
    "/lines.txt",
    new TextEncoder().encode("alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\n"),
  );
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createSplitCommands(),
    ...createCsplitCommands(),
    ...createNetworkCommands({ authorize: () => true }),
  ]) {
    registry.register(cmd, { replace: true });
  }
  const sh = new Shell({ fs, commands: registry });

  const t0 = performance.now();
  const r = await sh.exec(`
    sp_chunk=""
    sp_rr=""
    sp_v=""
    cs_out=""
    cs_ver=""
    cu_ver=""
    wg_ver=""
    gnu_ver=""
    for i in {1..150}; do
      sp_chunk=$(split -n l/2/3 /lines.txt)
      sp_rr=$(cat /lines.txt | split -n r/1/2)
      sp_v=$(split -l 3 --verbose /lines.txt /s_)
      cs_out=$(csplit -f /c_ -n 2 /lines.txt 3 5)
      cs_ver=$(csplit --version)
      cu_ver=$(curl --version)
      wg_ver=$(wget --version)
      gnu_ver=$(wc --version)
    done
    printf "\x25s|\x25s|\x25s|\x25s|\x25s|\x25s|\x25s|\x25s\n" "$sp_chunk" "$sp_rr" "$sp_v" "$cs_out" "$cs_ver" "$cu_ver" "$wg_ver" "$gnu_ver"
  `);
  const elapsed = performance.now() - t0;

  assert.equal(r.exitCode, 0, r.stderr);
  const parts = r.stdout.trim().split("|");
  assert.equal(parts[0], "delta\nepsilon");
  assert.equal(parts[1], "alpha\ngamma\nepsilon");
  assert.equal(parts[2], "creating file \x27/s_aa\x27\ncreating file \x27/s_ab\x27");
  assert.equal(parts[3], "11\n12\n13");
  assert.equal(parts[4], "csplit (virtual-bash)");
  assert.match(parts[5] ?? "", /^virtual-bash curl /);
  assert.match(parts[6] ?? "", /^virtual-bash wget /);
  assert.equal(parts[7], "wc (safe-bash virtual implementation)");
  assert.equal(new TextDecoder().decode(await fs.readFile("/s_aa")), "alpha\nbeta\ngamma\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/c_00")), "alpha\nbeta\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/c_01")), "gamma\ndelta\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/c_02")), "epsilon\nzeta\n");
  assert.ok(elapsed < 1500, `Expected fast sync execution (< 1500ms), took ${elapsed.toFixed(1)}ms`);
});

test("sync substitution and pipeline fast path for sponge, truncate, install, and apply_patch (Wave 157)", async () => {
  const fs = new MemoryFileSystem();
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createSpongeCommands(),
    ...createTruncateCommands(),
    ...createInstallCommands(),
    ...createApplyPatchCommands(),
  ]) {
    registry.register(cmd, { replace: true });
  }
  const sh = new Shell({ fs, commands: registry });

  const t0 = performance.now();
  const r = await sh.exec(`
    sp_out=""
    sp_ver=""
    tr_ver=""
    in_out=""
    in_ver=""
    ap_out=""
    for i in {1..150}; do
      sp_out=$(printf "soaked-line\n" | sponge)
      $(printf "abcdef\n" | sponge /sp.txt)
      $(truncate -s 4 /sp.txt)
      in_out=$(install -v /sp.txt /inst.txt)
      sp_ver=$(sponge --version)
      tr_ver=$(truncate --version)
      in_ver=$(install --version)
      ap_out=$(printf "*** Begin Patch\n*** Add File: /patched.txt\n+hello patch\n*** End Patch\n" | apply_patch)
    done
    printf "\x25s|\x25s|\x25s|\x25s|\x25s|\x25s\n" "$sp_out" "$sp_ver" "$tr_ver" "$in_out" "$in_ver" "$ap_out"
  `);
  const elapsed = performance.now() - t0;

  assert.equal(r.exitCode, 0, r.stderr);
  const parts = r.stdout.trim().split("|");
  assert.equal(parts[0], "soaked-line");
  assert.equal(parts[1], "sponge (virtual-bash)");
  assert.match(parts[2] ?? "", /^truncate /);
  assert.equal(parts[3], "\x27/sp.txt\x27 -> \x27/inst.txt\x27");
  assert.match(parts[4] ?? "", /^install /);
  assert.equal(parts[5], "Success. Updated the following files:\nA /patched.txt");
  assert.equal(new TextDecoder().decode(await fs.readFile("/sp.txt")), "abcd");
  assert.equal(new TextDecoder().decode(await fs.readFile("/inst.txt")), "abcd");
  assert.equal(new TextDecoder().decode(await fs.readFile("/patched.txt")), "hello patch\n");
  assert.ok(elapsed < 1500, `Expected fast sync execution (< 1500ms), took ${elapsed.toFixed(1)}ms`);
});

test("sync brace and arithmetic loop admission for 20+ command adapters via registerDefaultExecutors (Wave 158)", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a.txt", new TextEncoder().encode("alpha\nbeta\n"));
  await fs.writeFile("/b.txt", new TextEncoder().encode("alpha\nbeta\n"));
  await fs.writeFile("/c.txt", new TextEncoder().encode("alpha\nbeta\n"));
  await fs.writeFile("/data.csv", new TextEncoder().encode("name,score\nalice,10\nbob,20\n"));
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createBcCommands(),
    ...createDfCommands(),
    ...createFdCommands(),
    ...createFmtCommands(),
    ...createFoldCommands(),
    ...createHostnameCommands(),
    ...createIdCommands(),
    ...createNprocCommands(),
    ...createNumfmtCommands(),
    ...createOdCommands(),
    ...createSha512sumCommands(),
    ...createUnameCommands(),
    ...createWhoamiCommands(),
    ...createXxdCommands(),
    ...createDiff3Commands(),
    ...createPathchkCommands(),
    ...createDuCommands(),
    ...createTreeCommands(),
    ...createFileCommands(),
    ...createWhichCommands(),
    ...createXanCommands(),
  ]) {
    registry.register(cmd, { replace: true });
  }
  const sh = new Shell({ fs, commands: registry });

  const t0 = performance.now();
  const r = await sh.exec(`
    r_bc=""
    r_un=""
    r_id=""
    r_wh=""
    r_hn=""
    r_np=""
    r_nf=""
    r_xx=""
    r_d3=""
    r_xn=""
    for i in {1..150}; do
      r_bc=$(bc <<< "6 * 7")
      r_un=$(uname -s)
      r_id=$(id -u)
      r_wh=$(whoami)
      r_hn=$(hostname)
      r_np=$(nproc)
      r_nf=$(numfmt --to=iec <<< "1024")
      r_xx=$(xxd -p <<< "AB")
      r_d3=$(diff3 /a.txt /b.txt /c.txt)
      r_xn=$(xan count /data.csv)
    done
    printf "\x25s|\x25s|\x25s|\x25s|\x25s|\x25s|\x25s|\x25s|\x25s|\x25s\n" "$r_bc" "$r_un" "$r_id" "$r_wh" "$r_hn" "$r_np" "$r_nf" "$r_xx" "$r_d3" "$r_xn"
  `);
  const elapsed = performance.now() - t0;

  assert.equal(r.exitCode, 0, r.stderr);
  const parts = r.stdout.trim().split("|");
  assert.equal(parts[0], "42");
  assert.equal(parts[1], "Linux");
  assert.equal(parts[2], "1000");
  assert.equal(parts[3], "sandbox");
  assert.equal(parts[4], "sandbox");
  assert.ok(Number(parts[5]) >= 1);
  assert.equal(parts[6], "1.0K");
  assert.equal(parts[7], "41420a");
  assert.equal(parts[8], "");
  assert.equal(parts[9], "2");
  assert.ok(elapsed < 1500, `Expected fast sync brace-loop execution (< 1500ms), took ${elapsed.toFixed(1)}ms`);
});

test("sync mktemp and brace-loop admission for metadata, time-env, cmp, dd, expr, and grep-aliases (Wave 159)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  await fs.writeFile("/f1.txt", new TextEncoder().encode("alpha\nbeta\n"));
  await fs.writeFile("/f2.txt", new TextEncoder().encode("alpha\nbeta\n"));
  const registry = new CommandRegistry();
  for (const cmd of [
    ...createStandardCommands(),
    ...createMetadataCommands(),
    ...createTimeEnvCommands(),
    ...createCmpCommands(),
    ...createDdCommands(),
    ...createExprCommands(),
    ...createGrepAliasCommands(),
  ]) {
    registry.register(cmd, { replace: true });
  }
  const sh = new Shell({ fs, commands: registry, env: { APP_TAG: "prod-v9" } });

  const t0 = performance.now();
  const r = await sh.exec(`
    mk_u=""
    mk_f=""
    mk_d=""
    mk_ver=""
    dt_out=""
    pe_out=""
    ex_out=""
    eg_out=""
    for i in {1..150}; do
      mk_u=$(mktemp -u --suffix=.json)
      mk_f=$(mktemp /tmp/item.XXXXXX)
      mk_d=$(mktemp -d /tmp/dir.XXXXXX)
      mk_ver=$(mktemp --version)
      dt_out=$(date -u +%Y)
      pe_out=$(printenv APP_TAG)
      ex_out=$(expr 19 + 23)
      eg_out=$(egrep "^beta$" /f1.txt)
    done
    printf "\x25s|\x25s|\x25s|\x25s|\x25s|\x25s|\x25s|\x25s\n" "$mk_u" "$mk_f" "$mk_d" "$mk_ver" "$dt_out" "$pe_out" "$ex_out" "$eg_out"
  `);
  const elapsed = performance.now() - t0;

  assert.equal(r.exitCode, 0, r.stderr);
  const parts = r.stdout.trim().split("|");
  assert.match(parts[0] ?? "", /^\/tmp\/tmp\.[A-Za-z0-9]{10}\.json$/);
  assert.match(parts[1] ?? "", /^\/tmp\/item\.[A-Za-z0-9]{6}$/);
  assert.match(parts[2] ?? "", /^\/tmp\/dir\.[A-Za-z0-9]{6}$/);
  assert.equal(parts[3], "mktemp (safe-bash virtual implementation)");
  assert.match(parts[4] ?? "", /^\d{4}$/);
  assert.equal(parts[5], "prod-v9");
  assert.equal(parts[6], "42");
  assert.equal(parts[7], "beta");
  assert.equal((await fs.stat(parts[1]!)).type, "file");
  assert.equal((await fs.stat(parts[2]!)).type, "directory");
  assert.ok(elapsed < 1500, `Expected fast sync execution (< 1500ms), took ${elapsed.toFixed(1)}ms`);
});

test("sync substitution and loop admission covers mktemp -d permissions, install -m/-d modes, and agentCommands rg/egrep/fgrep/expr/dd/shuf/less (Wave 160)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  const registry = new CommandRegistry();
  for (const cmd of [...createAgentCommands({ muscleMemory: true }), ...createInstallCommands()]) {
    registry.register(cmd, { replace: true });
  }
  const sh = new Shell({ fs, commands: registry });
  const start = performance.now();
  const res = await sh.exec(`
    printf "alpha\nbeta\ngamma\n" > /tmp/w160.txt
    d1=$(mktemp -d /tmp/w160d.XXXXXX)
    f1=$(mktemp /tmp/w160f.XXXXXX)
    m_d1=$(stat -c %a "$d1")
    m_f1=$(stat -c %a "$f1")
    bad_mk=$(mktemp -d /tmp/no_such_dir_160/tmp.XXXXXX 2>/dev/null || echo "failed")
    _i1=$(install /tmp/w160.txt /tmp/w160_inst755.txt)
    _i2=$(install -m 600 /tmp/w160.txt /tmp/w160_inst600.txt)
    _i3=$(install -d -m 750 /tmp/w160_idir/sub)
    m_i755=$(stat -c %a /tmp/w160_inst755.txt)
    m_i600=$(stat -c %a /tmp/w160_inst600.txt)
    m_idir=$(stat -c %a /tmp/w160_idir/sub)
    for ((i = 0; i < 150; i++)); do
      a=$(rg -n beta /tmp/w160.txt)
      b=$(egrep "a|b" /tmp/w160.txt | head -n 1)
      c=$(fgrep "gamma" /tmp/w160.txt)
      d=$(expr 20 + 22)
      e=$(dd if=/tmp/w160.txt bs=5 count=1 status=none)
      f=$(shuf -i 7-7 -n 1)
      g=$(less /tmp/w160.txt | head -n 1)
    done
    printf "%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n" "$m_d1" "$m_f1" "$bad_mk" "$m_i755" "$m_i600" "$m_idir" "$a" "$b" "$c" "$d" "$e" "$f" "$g"
  `);
  const elapsed = performance.now() - start;
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "700|600|failed|755|600|750|2:beta|alpha|gamma|42|alpha|7|alpha\n");
  assert.ok(elapsed < 2500, `Expected Wave 160 sync loop under 2500ms, took ${elapsed.toFixed(1)}ms`);
});

test("sync substitution and pipeline fast path for tee, touch, cp, mv, rmdir, sleep, chmod, and patch (Wave 161)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  const registry = new CommandRegistry();
  for (const cmd of createAgentCommands({ muscleMemory: true })) {
    registry.register(cmd, { replace: true });
  }
  const sh = new Shell({ fs, commands: registry });
  const start = performance.now();
  const res = await sh.exec(`
    printf "line1\nline2\nline3\n" > /tmp/p_orig.txt
    printf -- "--- a/tmp/p_target.txt\n+++ b/tmp/p_target.txt\n@@ -1,3 +1,3 @@\n line1\n-line2\n+line2_patched\n line3\n" > /tmp/p.diff
    for ((i = 0; i < 150; i++)); do
      t_out=$(printf "hello" | tee /tmp/tee1.txt)
      _ta=$(printf "_world" | tee -a /tmp/tee1.txt)
      _tc=$(touch /tmp/touched.txt)
      cp_out=$(cp -v /tmp/p_orig.txt /tmp/p_copy.txt)
      mv_out=$(mv -v /tmp/p_copy.txt /tmp/p_target.txt)
      _ch=$(chmod 751 /tmp/p_target.txt)
      p_out=$(patch /tmp/p_target.txt /tmp/p.diff)
      _sl=$(sleep 0)
      mkdir -p /tmp/empty_dir
      rm_out=$(rmdir -v /tmp/empty_dir)
    done
    tee_val=$(cat /tmp/tee1.txt)
    patched_val=$(sed -n 2p /tmp/p_target.txt)
    ch_mode=$(stat -c %a /tmp/p_target.txt)
    t_exists=$(test -f /tmp/touched.txt && echo "yes")
    printf "%s|%s|%s|%s|%s|%s|%s|%s|%s\n" "$t_out" "$tee_val" "$cp_out" "$mv_out" "$p_out" "$patched_val" "$ch_mode" "$rm_out" "$t_exists"
  `);
  const elapsed = performance.now() - start;
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "hello|hello_world|'/tmp/p_orig.txt' -> '/tmp/p_copy.txt'|renamed '/tmp/p_copy.txt' -> '/tmp/p_target.txt'|patching file /tmp/p_target.txt|line2_patched|751|rmdir: removing directory, '/tmp/empty_dir'|yes\n"
  );
  assert.ok(elapsed < 2500, `Expected Wave 161 sync loop under 2500ms, took ${elapsed.toFixed(1)}ms`);
});

test("sync loop preflight dry-run and per-iteration dynamic execution for mktemp, tee -a, and mv (Wave 162)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  const registry = new CommandRegistry();
  for (const cmd of createAgentCommands({ muscleMemory: true })) {
    registry.register(cmd, { replace: true });
  }
  const sh = new Shell({ fs, commands: registry });
  const start = performance.now();
  const res = await sh.exec(`
    for i in {1..5}; do
      d=$(mktemp -d /tmp/w162d.XXXXXX)
    done
    mk_count=$(ls /tmp | grep "^w162d\\." | wc -l)

    printf "" > /tmp/w162_acc.txt
    for i in {1..5}; do
      _t=$(printf "x" | tee -a /tmp/w162_acc.txt)
      acc_len=$(cat /tmp/w162_acc.txt | wc -c)
    done
    acc_val=$(cat /tmp/w162_acc.txt)

    printf "payload\n" > /tmp/w162_once.txt
    for i in {1..1}; do
      mv_msg=$(mv -v /tmp/w162_once.txt /tmp/w162_moved.txt)
    done
    moved_val=$(cat /tmp/w162_moved.txt)
    printf "%s|%s|%s|%s|%s\n" "$mk_count" "$acc_val" "$acc_len" "$mv_msg" "$moved_val"
  `);
  const elapsed = performance.now() - start;
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(res.stdout, "5|xxxxx|5|renamed '/tmp/w162_once.txt' -> '/tmp/w162_moved.txt'|payload\n");
  assert.ok(elapsed < 1500, `Expected Wave 162 under 1500ms, took ${elapsed.toFixed(1)}ms`);
});

test("sync substitution and brace-loop admission for mkdir, rm, sha256sum, column, hexdump, fold, expand, fmt, xxd, od, and bc file operands (Wave 163)", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tmp", { recursive: true });
  const registry = new CommandRegistry();
  for (const cmd of createAgentCommands({ muscleMemory: true })) {
    registry.register(cmd, { replace: true });
  }
  const sh = new Shell({ fs, commands: registry });
  const start = performance.now();
  const res = await sh.exec(`
    printf "a b\nc d\n" > /tmp/w163_tbl.txt
    printf "hello" > /tmp/w163_hi.txt
    printf "20 + 22\n" > /tmp/w163_bc.txt
    for i in {1..150}; do
      mk_msg=$(mkdir -v /tmp/w163_dir)
      rm_msg=$(rm -dv /tmp/w163_dir)
      _mp=$(mkdir -p -m 750 /tmp/w163_nested/sub)
      m_sub=$(stat -c %a /tmp/w163_nested/sub)
      _rr=$(rm -rf /tmp/w163_nested)
      s256=$(sha256sum /tmp/w163_hi.txt)
      col_out=$(column -t /tmp/w163_tbl.txt | head -n 1)
      xxd_out=$(xxd -p /tmp/w163_hi.txt)
      bc_out=$(bc /tmp/w163_bc.txt)
    done
    printf "%s|%s|%s|%s|%s|%s|%s\n" "$mk_msg" "$rm_msg" "$m_sub" "\${s256%% *}" "$col_out" "$xxd_out" "$bc_out"
  `);
  const elapsed = performance.now() - start;
  assert.equal(res.exitCode, 0, res.stderr);
  assert.equal(
    res.stdout,
    "mkdir: created directory '/tmp/w163_dir'|removed '/tmp/w163_dir'|750|2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824|a  b|68656c6c6f|42\n"
  );
  assert.ok(elapsed < 2500, `Expected Wave 163 under 2500ms, took ${elapsed.toFixed(1)}ms`);
});

for (const [name, evaluate, args] of [
  ['rmdir', evalSyncRmdir, ['/directory']],
  ['rm -d', evalSyncRm, ['-d', '/directory']],
] as const) test(`${name} synchronous admission reads directory map cardinality`, () => {
  for (const occupied of [false, true]) {
    const entries = new Map<string, { type: 'file' }>();
    if (occupied) entries.set('keep', { type: 'file' });
    const removed: string[] = [];
    const result = evaluate(args, () => 'directory', () => entries, path => { removed.push(path); return true; });
    assert.equal(result, occupied ? undefined : '');
    assert.deepEqual(removed, occupied ? [] : ['/directory']);
  }
});
