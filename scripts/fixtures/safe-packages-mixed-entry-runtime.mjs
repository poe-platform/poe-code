import * as defaultEntry from "@poe-platform/safe-bash";
import { FileSystemQuotaError, withFileSystemQuota } from "@poe-platform/safe-fs/core";

export const expectedAgentCommandNames = Object.freeze([
  "true", "false", "echo", "pwd", "basename", "dirname", "printf", "mkdir", "touch",
  "cp", "mv", "rm", "rmdir", "ln", "readlink", "realpath", "ls", "cat", "head", "tail",
  "wc", "tee", "tr", "sort", "uniq", "cut", "grep", "test", "[", "env", "xargs", "find",
  "sed", "awk", "jq", "rg", "base64", "base32", "xxd", "od", "sha512sum", "sha384sum", "sha256sum", "sha224sum", "sha1sum",
  "md5sum", "cksum", "gzip", "gunzip", "zcat", "cmp", "fmt", "shuf", "numfmt", "diff", "patch", "chmod", "stat", "mktemp", "truncate", "tar", "zip", "unzip",
  "paste", "comm", "join", "tac", "expand", "fold", "strings", "seq", "nl", "rev", "unexpand", "split",
  "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column", "html-to-markdown", "du", "expr", "which", "timeout", "apply_patch", "xq", "xmllint",
].sort());

export const checksumWorkflows = Object.freeze([
  ["sha512sum", "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"],
  ["sha384sum", "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7"],
  ["sha224sum", "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7"],
].flatMap(([name, digest]) => [
  [`printf abc | ${name}`, `${digest}  -\n`],
  [`printf abc > /sha-data; ${name} --tag /sha-data`, `${name.slice(0, -3).toUpperCase()} (/sha-data) = ${digest}\n`],
  [`printf abc > /sha-data; ${name} --tag /sha-data > /sha-manifest; ${name} --check /sha-manifest`, "/sha-data: OK\n"],
  [`printf abc > /sha-data; ${name} -z /sha-data`, `${digest}  /sha-data\0`],
]));

export const nullDeviceWorkflows = Object.freeze([
  ["cat /dev/null", ""],
  ["printf discarded > /dev/null; printf appended >> /dev/null; cat /dev/null", ""],
  ["printf copied | tee /dev/null; cat /dev/null", "copied"],
  ["printf source > /device-input; cp /device-input /dev/null; cp /dev/null /device-output; cat /device-output", ""],
  ["test -c /dev/null && test ! -f /dev/null && stat -c '%F %s' /dev/null", "character special file 0\n"],
  ["cd /dev; printf relative > ./null; cat null", ""],
]);

export async function verifyCmpCommands(entry = defaultEntry) {
  const filesystem = new entry.MemoryFileSystem();
  await filesystem.writeFile("/cmp-left", new Uint8Array([0, 10, 255]));
  await filesystem.writeFile("/cmp-right", new Uint8Array([0, 10, 254]));
  await filesystem.writeFile("/cmp-empty", new Uint8Array());
  await filesystem.writeFile("/cmp-prefixed", new Uint8Array([9, 0, 10, 255]));
  await filesystem.writeFile("/cmp-long", new Uint8Array(100).fill(1));
  await filesystem.writeFile("/cmp-shared-input", new TextEncoder().encode("abcdef\n"));
  await filesystem.writeFile("/cmp-expected-prefix", new TextEncoder().encode("axyz\n"));
  const shell = new entry.Shell({ fs: filesystem, env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    for (const [script, exitCode, stdout, stderr = ""] of [
      ["cmp /cmp-left /cmp-left", 0, ""],
      ["cmp /cmp-left /cmp-right", 1, "/cmp-left /cmp-right differ: char 3, line 2\n"],
      ["LC_ALL=C.UTF-8 cmp /cmp-left /cmp-right", 1, "/cmp-left /cmp-right differ: byte 3, line 2\n"],
      ["cmp --silent /cmp-left /cmp-right", 1, ""],
      ["cmp -l /cmp-left /cmp-right", 1, "3 377 376\n"],
      ["cmp -n 2 /cmp-left /cmp-right", 0, ""],
      ["cmp -n1 -n3 /cmp-left /cmp-right", 0, ""],
      ["cmp -i1:0 /cmp-prefixed /cmp-left", 0, ""],
      ["cmp /cmp-prefixed /cmp-left 1 0", 0, ""],
      ["cmp -b /cmp-left /cmp-right", 1, "/cmp-left /cmp-right differ: byte 3, line 2 is 377 M-^? 376 M-~\n"],
      ["printf '\\000\\012\\377' | cmp - /cmp-left", 0, ""],
      ["cmp /dev/null /cmp-empty", 0, ""],
      ["{ cmp -n1 - /cmp-expected-prefix; cat; } </cmp-shared-input", 0, "bcdef\n"],
      ["cat /cmp-shared-input | { cmp -n1 - /cmp-expected-prefix; cat; }", 0, "bcdef\n"],
      ["cmp -l </cmp-left - /cmp-long", 1, "1   0   1\n2  12   1\n3 377   1\n", "cmp: EOF on - after byte 3\n"],
      ["cmp -i1:2 </cmp-long - -", 2, "", "cmp: EOF on - which is empty\ncmp: -: Bad file descriptor\n"],
      ["cmp -l /cmp-shared-input /cmp-expected-prefix >/dev/null", 1, ""],
      ["cmp -l /cmp-shared-input /cmp-expected-prefix 3>/dev/null 1>&3", 1, ""],
      ["ln -s /dev/null /cmp-null-alias; cmp -l /cmp-shared-input /cmp-expected-prefix >/cmp-null-alias", 1, ""],
      ["cmp -l /cmp-empty /cmp-shared-input >/dev/null", 1, "", "cmp: EOF on /cmp-empty which is empty\n"],
    ]) {
      const result = await shell.exec(script);
      if (result.exitCode !== exitCode || result.stdout !== stdout || result.stderr !== stderr) {
        throw new Error(`Public cmp failed: ${script}: ${JSON.stringify(result)}`);
      }
    }
  } finally { await shell.dispose(); }
}

export async function verifyFmtCommands(entry = defaultEntry) {
  const filesystem = new entry.MemoryFileSystem();
  await filesystem.writeFile("/fmt-paragraph", new TextEncoder().encode("alpha beta gamma delta epsilon zeta eta theta\n"));
  const shell = new entry.Shell({ fs: filesystem, env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    for (const [script, stdin, exitCode, stdout, stderr = ""] of [
      ["fmt -w20 /fmt-paragraph", "", 0, "alpha beta gamma\ndelta epsilon zeta\neta theta\n"],
      ["cat /fmt-paragraph | fmt -w20", "", 0, "alpha beta gamma\ndelta epsilon zeta\neta theta\n"],
      ["env fmt -w20 /fmt-paragraph", "", 0, "alpha beta gamma\ndelta epsilon zeta\neta theta\n"],
      ["printf /fmt-paragraph | xargs fmt -w20", "", 0, "alpha beta gamma\ndelta epsilon zeta\neta theta\n"],
      ["fmt -w20 </fmt-paragraph >/fmt-output; cat /fmt-output", "", 0, "alpha beta gamma\ndelta epsilon zeta\neta theta\n"],
      ["fmt -u -w24", "First sentence.    Second sentence.\n\n  indented words continue here\n", 0, "First sentence.\nSecond sentence.\n\n  indented words\n  continue here\n"],
      ["fmt -p '> ' -w16", "> alpha beta gamma delta epsilon\nuntouched text here\n", 0, "> alpha beta\n> gamma delta\n> epsilon\nuntouched text here\n"],
      ["fmt -w2501", "unchanged\n", 1, "", "fmt: invalid width: '2501': Numerical result out of range\n"],
      ["fmt \"'?\"", "", 1, "", "fmt: cannot open ''\\''?' for reading: No such file or directory\n"],
    ]) {
      const result = await shell.exec(script, { stdin });
      if (result.exitCode !== exitCode || result.stdout !== stdout || result.stderr !== stderr) {
        throw new Error(`Public fmt failed: ${script}: ${JSON.stringify(result)}`);
      }
    }
    const binary = await shell.exec("fmt -u -w10", { stdin: new Uint8Array([255, 32, 32, 97, 10]) });
    if (binary.exitCode !== 0 || binary.stderr !== "" || JSON.stringify(Array.from(binary.stdoutBytes)) !== "[255,32,97,10]") {
      throw new Error(`Public fmt binary output changed: ${JSON.stringify(binary)}`);
    }
  } finally { await shell.dispose(); }
}

export async function verifyShufCommands(entry = defaultEntry) {
  const filesystem = new entry.MemoryFileSystem();
  await filesystem.writeFile("/shuf-random", new Uint8Array(64));
  await filesystem.writeFile("/shuf-sparse-random", new Uint8Array([0, 0, 1, 0, 0]));
  await filesystem.writeFile("/shuf-lines", new TextEncoder().encode("alpha\nbeta\ngamma\n"));
  const shell = new entry.Shell({ fs: filesystem, env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    for (const [script, stdout, stderr = "", exitCode = 0] of [
      ["shuf --random-source=/shuf-random /shuf-lines", "alpha\nbeta\ngamma\n"],
      ["cat /shuf-lines | shuf --random-source=/shuf-random", "alpha\nbeta\ngamma\n"],
      ["env shuf --random-source=/shuf-random /shuf-lines", "alpha\nbeta\ngamma\n"],
      ["printf /shuf-lines | xargs shuf --random-source=/shuf-random", "alpha\nbeta\ngamma\n"],
      ["shuf --random-source=/shuf-random -o /shuf-lines /shuf-lines; cat /shuf-lines", "alpha\nbeta\ngamma\n"],
      ["shuf --random-source=/shuf-random -i7-10 -n3", "7\n8\n9\n"],
      ["shuf --random-source=/shuf-sparse-random -i0-131071 -n2", "1\n1\n"],
      ["shuf --random-source=/missing -n0 -e alpha beta", ""],
      ["shuf --random-source=/missing -i1-18446744073709551615 -n0 -o /shuf-empty; test -f /shuf-empty && cat /shuf-empty", ""],
      ["shuf -- \"'?\"", "", "shuf: ''\\''?': No such file or directory\n", 1],
      ["shuf -- \"#'\"", "", "shuf: \"#'\": No such file or directory\n", 1],
    ]) {
      const result = await shell.exec(script);
      if (result.exitCode !== exitCode || result.stdout !== stdout || result.stderr !== stderr) {
        throw new Error(`Public shuf failed: ${script}: ${JSON.stringify(result)}`);
      }
    }
    const bytes = new Uint8Array([255, 0, 0, 65, 0]);
    const binary = await shell.exec("shuf --random-source=/shuf-random -z", { stdin: bytes });
    if (binary.exitCode !== 0 || binary.stderr !== "" || JSON.stringify(Array.from(binary.stdoutBytes)) !== "[255,0,0,65,0]") {
      throw new Error(`Public shuf binary output changed: ${JSON.stringify(binary)}`);
    }
  } finally { await shell.dispose(); }
}

export async function verifyNumfmtCommands(entry = defaultEntry) {
  const filesystem = new entry.MemoryFileSystem();
  await filesystem.writeFile("/numfmt-numbers", new TextEncoder().encode("1024\n1048576\n"));
  await filesystem.writeFile("/numfmt-table", new TextEncoder().encode("name,bytes\nalpha,1000\nbeta,2500000\n"));
  await filesystem.writeFile("/numfmt-script", new TextEncoder().encode("numfmt --header --delimiter=, --field=2 --to=si < /numfmt-table > /numfmt-output\ncat /numfmt-output\n"));
  const shell = new entry.Shell({ fs: filesystem, env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    for (const [script, stdout, stderr = "", exitCode = 0] of [
      ["numfmt --to=si 1000 2500000", "1.0K\n2.5M\n"],
      ["cat /numfmt-numbers | numfmt --to=iec", "1.0K\n1.0M\n"],
      ["env numfmt --from=iec-i 1Ki 2Mi", "1024\n2097152\n"],
      ["printf '1000 2000' | xargs numfmt --to=si", "1.0K\n2.0K\n"],
      ["sh /numfmt-script", "name,bytes\nalpha,1.0K\nbeta,2.5M\n"],
      ["numfmt --round=nearest --format=%.1f -- 1.25 -1.25", "1.3\n-1.3\n"],
      ["numfmt --from=iec-i 1Ki invalid 2Mi", "1024\n", "numfmt: invalid number: 'invalid'\n", 2],
    ]) {
      const result = await shell.exec(script);
      if (result.exitCode !== exitCode || result.stdout !== stdout || result.stderr !== stderr) {
        throw new Error(`Public numfmt failed: ${script}: ${JSON.stringify(result)}`);
      }
    }
    const binary = await shell.exec("numfmt --delimiter=, --field=2 --to=si", { stdin: new Uint8Array([255, 44, 49, 48, 48, 48, 10]) });
    if (binary.exitCode !== 0 || binary.stderr !== "" || JSON.stringify(Array.from(binary.stdoutBytes)) !== "[255,44,49,46,48,75,10]") {
      throw new Error(`Public numfmt binary output changed: ${JSON.stringify(binary)}`);
    }
  } finally { await shell.dispose(); }
}

export async function verifyZipCommands(entry = defaultEntry) {
  const filesystem = new entry.MemoryFileSystem();
  await filesystem.mkdir("/zip-work");
  const binary = new Uint8Array([0, 255, 128, 10, 13, 65]);
  await filesystem.writeFile("/zip-work/binary", binary);
  await filesystem.writeFile("/zip-work/retained", new TextEncoder().encode("retained\n"));
  await filesystem.writeFile("/zip-work/workflow.sh", new TextEncoder().encode(
    "zip archive binary retained\nprintf 'updated\\n' > retained\nzip archive retained\nunzip -o -d extracted archive.zip\n",
  ));
  const shell = new entry.Shell({ fs: filesystem, cwd: "/zip-work", env: { LC_ALL: "C", TZ: "UTC" } }).use(entry.agentCommands());
  try {
    if (entry.createZipCommand().name !== "zip" || entry.createUnzipCommand().name !== "unzip") throw new Error("Public ZIP factories are missing");
    const result = await shell.exec("sh workflow.sh");
    const expected = "  adding: binary (stored 0%)\n  adding: retained (stored 0%)\nupdating: retained (stored 0%)\nArchive:  archive.zip\n extracting: extracted/binary        \n extracting: extracted/retained      \n";
    if (result.exitCode !== 0 || result.stderr !== "" || result.stdout !== expected) throw new Error(`Public ZIP saved script failed: ${JSON.stringify(result)}`);
    const restored = await filesystem.readFile("/zip-work/extracted/binary");
    if (restored.length !== binary.length || restored.some((value, index) => value !== binary[index])) throw new Error("Public ZIP binary content changed");
    if (new TextDecoder().decode(await filesystem.readFile("/zip-work/extracted/retained")) !== "updated\n") throw new Error("Public ZIP update failed");
    const listed = await shell.exec("unzip -l archive.zip");
    if (listed.exitCode !== 0 || listed.stderr !== "" || !listed.stdout.endsWith("---------                     -------\n       14                     2 files\n")) throw new Error(`Public ZIP listing failed: ${JSON.stringify(listed)}`);
  } finally { await shell.dispose(); }
}

export async function verifyTruncateCommands(entry = defaultEntry) {
  const filesystem = new entry.MemoryFileSystem();
  await filesystem.writeFile("/truncate-file", new Uint8Array([1, 2, 3, 4, 5, 6]), { mode: 0o620 });
  await filesystem.writeFile("/truncate-reference", new Uint8Array([7, 8, 9]));
  await filesystem.writeFile("/truncate-script", new TextEncoder().encode("truncate -r /truncate-reference /truncate-script-output\nstat -c '%a:%s' /truncate-script-output\n"));
  const shell = new entry.Shell({ fs: filesystem, env: { LC_ALL: "C" } }).use(entry.agentCommands({ metadata: { umask: 0o027 } }));
  try {
    for (const [script, stdout, stderr = "", exitCode = 0] of [
      ["truncate -s9 /truncate-file /truncate-new; stat -c '%a:%s' /truncate-file /truncate-new", "620:9\n640:9\n"],
      ["env truncate -s2 /truncate-file; stat -c '%s' /truncate-file | cat", "2\n"],
      ["printf /truncate-new | xargs truncate -s+1; stat -c '%s' /truncate-new", "10\n"],
      ["sh /truncate-script", "640:3\n"],
      ["truncate -s0 /dev/null", "", "truncate: failed to truncate '/dev/null' at 0 bytes: Invalid argument\n", 1],
      ["truncate -s+1 /dev/null", "", "truncate: failed to truncate '/dev/null' at 1 bytes: Invalid argument\n", 1],
      ["truncate -s/4 /dev/null", "", "truncate: failed to truncate '/dev/null' at 0 bytes: Invalid argument\n", 1],
      ["truncate -r /dev/null /truncate-null-reference", ""],
      ["truncate -s0 /dev/null/", "", "truncate: cannot open '/dev/null/' for writing: Is a directory\n", 1],
      ["truncate -cs0 /dev/null/", "", "truncate: cannot open '/dev/null/' for writing: Not a directory\n", 1],
    ]) {
      const result = await shell.exec(script);
      if (result.exitCode !== exitCode || result.stdout !== stdout || result.stderr !== stderr) {
        throw new Error(`Public truncate failed: ${script}: ${JSON.stringify(result)}`);
      }
    }
    for (const [path, bytes] of [["/truncate-file", [1, 2]], ["/truncate-new", new Array(10).fill(0)], ["/truncate-script-output", [0, 0, 0]], ["/truncate-null-reference", []]]) {
      if (JSON.stringify(Array.from(await filesystem.readFile(path))) !== JSON.stringify(bytes)) throw new Error(`Public truncate bytes changed: ${path}`);
    }
    const retained = await filesystem.openResizeFile("/truncate-file");
    try {
      await filesystem.rename("/truncate-file", "/truncate-moved");
      await filesystem.writeFile("/truncate-file", new Uint8Array([99]));
      await retained.truncate(4);
      if (JSON.stringify(Array.from(await filesystem.readFile("/truncate-moved"))) !== "[1,2,0,0]"
        || JSON.stringify(Array.from(await filesystem.readFile("/truncate-file"))) !== "[99]") throw new Error("Public retained resize retargeted a replacement pathname");
    } finally { await retained.close(); }
  } finally { await shell.dispose(); }
  const backing = new entry.MemoryFileSystem();
  await backing.writeFile("/quota-file", new Uint8Array([1, 2, 3]));
  const failures = [];
  const limited = new entry.Shell({ fs: withFileSystemQuota(backing, { maxBytes: 4 }), onInternalError: error => failures.push(error) }).use(entry.agentCommands());
  try {
    const result = await limited.exec("truncate -s8 /quota-file");
    if (result.exitCode !== 1 || !failures.some(error => error instanceof FileSystemQuotaError)
      || JSON.stringify(Array.from(await backing.readFile("/quota-file"))) !== "[1,2,3]") throw new Error("Public truncate bypassed quota admission or lost its refusal");
  } finally { await limited.dispose(); }
}

export async function verifyNullDeviceView(filesystem) {
  const backing = filesystem.createMemoryFileSystem();
  await backing.mkdir("/dev");
  await backing.writeFile("/dev/null", new TextEncoder().encode("historical"));
  await backing.writeFile("/dev/sibling", new TextEncoder().encode("sibling"));
  const device = filesystem.createDeviceFileSystem(backing);
  if (device === backing || filesystem.createDeviceFileSystem(device) !== device) {
    throw new Error("Public device view is not an idempotent wrapper");
  }
  const stat = await device.stat("/dev/null");
  if (stat.type !== "character" || stat.size !== 0 || stat.allocatedBytes !== 0) {
    throw new Error("Public null-device metadata is incorrect");
  }
  await device.writeFile("/dev/./null", new TextEncoder().encode("discarded"));
  await device.appendFile("/dev/null", new TextEncoder().encode("discarded"));
  if ((await device.readFile("/dev/null")).length !== 0) throw new Error("Public null-device read is not EOF");
  if (new TextDecoder().decode(await backing.readFile("/dev/null")) !== "historical") {
    throw new Error("Public device view changed the historical backing row");
  }
  const entries = await device.readdir("/dev");
  if (entries.filter(entry => entry.name === "null" && entry.type === "character").length !== 1
    || !entries.some(entry => entry.name === "sibling" && entry.type === "file")) {
    throw new Error("Public device directory did not merge and mask entries");
  }
  let exclusiveError;
  try { await device.writeFile("/dev/null", new Uint8Array(), { flag: "wx" }); }
  catch (error) { exclusiveError = error; }
  if (exclusiveError?.code !== "EEXIST") throw new Error("Public null-device exclusive creation did not reject");
}

export async function runNestedCommands(entry = defaultEntry, options = {}) {
  const failures = [];
  const shell = new entry.Shell({
    fs: new defaultEntry.MemoryFileSystem(),
    onInternalError(error) { failures.push(error.message); },
  }).use(defaultEntry.agentCommands(options));
  try {
    const results = [];
    for (const script of ["env jq -nc '1+1'", "printf '\"1+1\"' | xargs jq -nc", "env env jq -nc '1+1'", "printf '\"1+1\"' | xargs env jq -nc"]) {
      const { exitCode, stdout, stderr } = await shell.exec(script);
      results.push({ script, exitCode, stdout, stderr });
    }
    return { results, failures };
  } finally { await shell.dispose(); }
}

export { defaultEntry };
