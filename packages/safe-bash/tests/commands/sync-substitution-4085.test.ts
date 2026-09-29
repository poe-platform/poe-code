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
  assert.equal(r2.stdout, "safe-bash:9000:8080:80\n");
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
