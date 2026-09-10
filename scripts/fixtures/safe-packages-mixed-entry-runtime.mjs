import * as defaultEntry from "@poe-platform/safe-bash";
import { createCsplitCommand as createSubpathCsplitCommand } from "@poe-platform/safe-bash/commands/csplit";
import { createPrCommand as createSubpathPrCommand, createPrCommands as createSubpathPrCommands, prCommands as subpathPrCommands } from "@poe-platform/safe-bash/commands/pr";
import { createTsortCommand as createSubpathTsortCommand, createTsortCommands as createSubpathTsortCommands, tsortCommands as subpathTsortCommands } from "@poe-platform/safe-bash/commands/tsort";
import { createFactorCommand as createSubpathFactorCommand, createFactorCommands as createSubpathFactorCommands, factorCommands as subpathFactorCommands } from "@poe-platform/safe-bash/commands/factor";
import { createGetoptCommand as createSubpathGetoptCommand, createGetoptCommands as createSubpathGetoptCommands, getoptCommands as subpathGetoptCommands } from "@poe-platform/safe-bash/commands/getopt";
import { FileSystemQuotaError, withFileSystemQuota } from "@poe-platform/safe-fs/core";

export const expectedAgentCommandNames = Object.freeze([
  "true", "false", "echo", "pwd", "basename", "dirname", "printf", "mkdir", "touch",
  "cp", "mv", "rm", "rmdir", "ln", "readlink", "realpath", "ls", "cat", "head", "tail",
  "wc", "tee", "tr", "sort", "uniq", "cut", "grep", "test", "[", "env", "xargs", "find",
  "sed", "awk", "jq", "rg", "base64", "base32", "xxd", "od", "sha512sum", "sha384sum", "sha256sum", "sha224sum", "sha1sum",
  "md5sum", "cksum", "gzip", "gunzip", "zcat", "bzip2", "bunzip2", "bzcat", "xz", "unxz", "xzcat", "zstd", "unzstd", "zstdcat", "cmp", "fmt", "shuf", "numfmt", "diff", "patch", "chmod", "stat", "mktemp", "truncate", "tar", "zip", "unzip",
  "paste", "comm", "join", "tac", "expand", "fold", "strings", "seq", "nl", "rev", "unexpand", "split",
  "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column", "html-to-markdown", "du", "expr", "which", "timeout", "apply_patch", "xq", "xmllint", "csplit", "pr", "tsort", "factor", "getopt",
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

export async function verifyCsplitCommands(entry = defaultEntry) {
  const filesystem = new entry.MemoryFileSystem();
  await filesystem.mkdir("/csplit-work");
  const first = new TextEncoder().encode("alpha\nbeta\n");
  const last = new TextEncoder().encode("gamma\n");
  const binary = new Uint8Array([0, 255, 10, 65, 10]);
  await filesystem.writeFile("/csplit-work/input", new TextEncoder().encode("alpha\nbeta\ngamma\n"));
  await filesystem.writeFile("/csplit-work/bytes", binary);
  await filesystem.writeFile("/csplit-work/workflow.sh", new TextEncoder().encode(
    "csplit -f piece -b '%02d.dat' input '/beta/+1'\ncsplit -f raw -b '%02d.bin' bytes 2\n",
  ));
  const shell = new entry.Shell({ fs: filesystem, cwd: "/csplit-work", env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    if (entry.createCsplitCommand().name !== "csplit") throw new Error("Public csplit factory is missing");
    if (entry.createCsplitCommand !== createSubpathCsplitCommand) throw new Error("Csplit subpath factory identity differs");
    const result = await shell.exec("sh workflow.sh");
    if (result.exitCode !== 0 || result.stderr !== "" || result.stdout !== "11\n6\n3\n2\n") throw new Error(`Public csplit saved script failed: ${JSON.stringify(result)}`);
    for (const [name, expected] of [["piece00.dat", first], ["piece01.dat", last], ["raw00.bin", binary.slice(0, 3)], ["raw01.bin", binary.slice(3)]]) {
      const actual = await filesystem.readFile(`/csplit-work/${name}`);
      if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) throw new Error(`Public csplit changed ${name}`);
    }
  } finally { await shell.dispose(); }
}

export async function verifyPrCommands(entry = defaultEntry) {
  const filesystem = new entry.MemoryFileSystem();
  const binary = new Uint8Array([0, 255, 10, 65, 10]);
  await filesystem.mkdir("/pr-work");
  await filesystem.symlink("/dev/null", "/pr-work/null-link");
  await filesystem.writeFile("/pr-work/input", new TextEncoder().encode("alpha\nbeta\n"));
  await filesystem.writeFile("/pr-work/columns", new TextEncoder().encode("alpha\nbeta\ngamma\ndelta\n"));
  await filesystem.writeFile("/pr-work/bytes", binary);
  await filesystem.writeFile("/pr-work/workflow.sh", new TextEncoder().encode(
    "pr -t -n:2 input > numbered\npr -t bytes > copied\npr -t -2 -s'|' columns\n",
  ));
  const shell = new entry.Shell({ fs: filesystem, cwd: "/pr-work", env: { LC_ALL: "C", TZ: "UTC" } }).use(entry.agentCommands());
  try {
    if (entry.createPrCommand().name !== "pr") throw new Error("Public pr factory is missing");
    if (entry.createPrCommand !== createSubpathPrCommand || entry.createPrCommands !== createSubpathPrCommands || entry.prCommands !== subpathPrCommands) throw new Error("Pr subpath factory identity differs");
    for (const input of ["/dev/null", "/pr-work/null-link"]) {
      const empty = await shell.exec(`pr -t ${input}`);
      if (empty.exitCode !== 0 || empty.stdoutBytes.length !== 0 || empty.stderrBytes.length !== 0) throw new Error(`Public pr null input failed: ${input}: ${JSON.stringify(empty)}`);
    }
    const result = await shell.exec("sh workflow.sh");
    if (result.exitCode !== 0 || result.stderr !== "" || result.stdout !== "alpha|gamma\nbeta|delta\n") throw new Error(`Public pr saved script failed: ${JSON.stringify(result)}`);
    for (const [name, expected] of [["numbered", new TextEncoder().encode(" 1:alpha\n 2:beta\n")], ["copied", binary]]) {
      const actual = await filesystem.readFile(`/pr-work/${name}`);
      if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) throw new Error(`Public pr changed ${name}`);
    }
  } finally { await shell.dispose(); }
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  for (const phase of ["owned stdout", "reader next getter"]) {
    const backing = new entry.MemoryFileSystem();
    await backing.writeFile("/input", Uint8Array.of(65, 10));
    const caller = new AbortController();
    const consumer = new AbortController();
    const entered = deferred();
    const gate = deferred();
    let settled = false;
    let completed = false;
    let writes = 0;
    let getters = 0;
    let pulls = 0;
    let returns = 0;
    if (phase === "reader next getter") {
      backing.readStream = () => ({ [Symbol.asyncIterator]() { return {
        get next() {
          getters++;
          caller.abort(false);
          return async () => { pulls++; throw new Error("Public DeviceFS admitted an aborted next method"); };
        },
        async return() {
          returns++;
          entered.resolve();
          await gate.promise;
          completed = true;
          return { done: true, value: undefined };
        },
      }; } });
    }
    const sink = {
      async write() { throw new Error("Public pr bypassed enrolled stdout"); },
      ownedOutput: {
        consumerClosed: consumer.signal,
        async write() {
          writes++;
          entered.resolve();
          try { await gate.promise; caller.signal.throwIfAborted(); }
          finally { completed = true; }
        },
      },
    };
    const candidate = new entry.Shell({ fs: backing, env: { LC_ALL: "C", TZ: "UTC" } }).use(entry.agentCommands());
    const execution = candidate.exec("pr -t input", { signal: caller.signal, stdout: sink });
    const outcome = execution.then(
      value => { settled = true; return { ok: true, value }; },
      error => { settled = true; return { ok: false, error }; },
    );
    try {
      await Promise.race([entered.promise, outcome.then(() => { throw new Error(`Public pr ${phase} did not enter its held operation`); })]);
      if (phase === "owned stdout") caller.abort(false);
      for (let turn = 0; turn < 2; turn++) await new Promise(resolve => setTimeout(resolve, 0));
      if (settled || completed || pulls !== 0 || writes !== (phase === "owned stdout" ? 1 : 0)
        || getters !== (phase === "reader next getter" ? 1 : 0) || returns !== (phase === "reader next getter" ? 1 : 0)) {
        throw new Error(`Public pr ${phase} failed held cleanup: ${JSON.stringify({ settled, completed, writes, getters, pulls, returns })}`);
      }
      gate.resolve();
      const result = await outcome;
      if (result.ok || result.error !== false || !completed) throw new Error(`Public pr ${phase} lost false abort or cleanup completion`);
      if (phase === "reader next getter" && (pulls !== 0 || returns !== 1)) throw new Error("Public DeviceFS did not retain exactly one iterator cleanup");
    } finally {
      gate.resolve();
      await outcome;
      await candidate.dispose();
    }
  }
  for (const name of ["pr", "tsort"]) for (const phase of ["factory", "next", "capability", "write"]) {
    const caller = new AbortController();
    let release;
    let returned;
    const gate = new Promise(resolve => { release = resolve; });
    const returnEntered = new Promise(resolve => { returned = resolve; });
    let factories = 0;
    let reads = 0;
    let returns = 0;
    let writes = 0;
    let writeGetters = 0;
    let settled = false;
    let drained = false;
    const iterator = {
      get next() {
        if (this !== iterator) throw new Error("Direct input next getter lost its receiver");
        if (phase === "next") caller.abort(false);
        return async function () {
          if (this !== iterator) throw new Error("Direct input next lost its receiver");
          reads++;
          return { done: true, value: undefined };
        };
      },
      async return() {
        if (this !== iterator) throw new Error("Direct input return lost its receiver");
        returns++;
        returned();
        if (phase === "next") await gate;
        drained = true;
        return { done: true, value: undefined };
      },
    };
    const stdin = {
      get [Symbol.asyncIterator]() {
        if (this !== stdin) throw new Error("Direct input factory getter lost its receiver");
        if (phase === "factory") caller.abort(false);
        return function () {
          if (this !== stdin) throw new Error("Direct input factory lost its receiver");
          factories++;
          return iterator;
        };
      },
    };
    const capability = {
      consumerClosed: new AbortController().signal,
      get write() {
        if (this !== capability) throw new Error("Direct stderr write getter lost its receiver");
        writeGetters++;
        if (phase === "write") caller.abort(false);
        return async function () {
          if (this !== capability) throw new Error("Direct stderr write lost its receiver");
          writes++;
        };
      },
    };
    const stderr = {
      async write() { throw new Error("Direct stderr used opaque write instead of its capability"); },
      get ownedOutput() {
        if (this !== stderr) throw new Error("Direct stderr capability getter lost its receiver");
        if (phase === "capability") caller.abort(false);
        return capability;
      },
    };
    const command = name === "pr" ? entry.createPrCommand() : entry.createTsortCommand();
    const diagnostic = phase === "capability" || phase === "write";
    const outcome = Promise.resolve(command.execute({
      command: name, args: diagnostic ? ["--unknown"] : name === "pr" ? ["-t"] : [],
      cwd: "/", env: { LC_ALL: "C", TZ: "UTC" }, fs: new entry.MemoryFileSystem(),
      signal: caller.signal, stdin, stderr,
      stdout: { async write() { throw new Error("Direct canceled command wrote stdout"); } },
    })).then(value => { settled = true; return { ok: true, value }; }, error => { settled = true; return { ok: false, error }; });
    try {
      if (phase === "next") {
        await Promise.race([returnEntered, outcome.then(() => { throw new Error(`Direct ${name} did not retain input cleanup`); })]);
        for (let turn = 0; turn < 2; turn++) await new Promise(resolve => setTimeout(resolve, 0));
        if (settled || drained || returns !== 1) throw new Error(`Direct ${name} settled before retained input cleanup`);
        release();
      }
      const result = await outcome;
      if (result.ok || result.error !== false || factories !== (phase === "next" ? 1 : 0) || reads !== 0 || returns !== (phase === "next" ? 1 : 0) || writes !== 0 || writeGetters !== (phase === "write" ? 1 : 0) || drained !== (phase === "next")) {
        throw new Error(`Direct ${name} ${phase} getter admitted canceled work: ${JSON.stringify({ ok: result.ok, factories, reads, returns, writes, writeGetters, drained })}`);
      }
    } finally { release(); await outcome; }
  }
}

export async function verifyTsortCommands(entry = defaultEntry) {
  const filesystem = new entry.MemoryFileSystem();
  const encoder = new TextEncoder();
  await filesystem.mkdir("/tsort-work");
  await filesystem.symlink("/dev/null", "/tsort-work/null-link");
  await filesystem.writeFile("/tsort-work/workflow.sh", encoder.encode('tsort < "$1"\n'));
  const cases = [
    ["acyclic", encoder.encode("a b z z\n"), 0, encoder.encode("a\nz\nb\n"), new Uint8Array()],
    ["cycle", encoder.encode("a b b a\n"), 1, encoder.encode("a\nb\n"), encoder.encode("tsort: -: input contains a loop:\ntsort: a\ntsort: b\n")],
    ["raw", Uint8Array.of(255, 32, 255, 32, 254, 32, 254, 10), 0, Uint8Array.of(254, 10, 255, 10), new Uint8Array()],
  ];
  const shell = new entry.Shell({ fs: filesystem, cwd: "/tsort-work", env: { LC_ALL: "C", TZ: "UTC" } }).use(entry.agentCommands());
  try {
    if (entry.createTsortCommand().name !== "tsort") throw new Error("Public tsort factory is missing");
    if (entry.createTsortCommand !== createSubpathTsortCommand || entry.createTsortCommands !== createSubpathTsortCommands || entry.tsortCommands !== subpathTsortCommands) throw new Error("Tsort subpath factory identity differs");
    for (const input of ["/dev/null", "/tsort-work/null-link"]) {
      const empty = await shell.exec(`tsort ${input}`);
      if (empty.exitCode !== 0 || empty.stdoutBytes.length !== 0 || empty.stderrBytes.length !== 0) throw new Error(`Public tsort null input failed: ${input}: ${JSON.stringify(empty)}`);
    }
    for (const [name, input, status, stdout, stderr] of cases) {
      await filesystem.writeFile(`/tsort-work/${name}`, input);
      const result = await shell.exec(`sh workflow.sh ${name}`);
      if (result.exitCode !== status) throw new Error(`Public tsort ${name} status differs: ${result.exitCode}`);
      for (const [stream, expected] of [["stdoutBytes", stdout], ["stderrBytes", stderr]]) {
        const actual = result[stream];
        if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) throw new Error(`Public tsort ${name} ${stream} differs: ${JSON.stringify(Array.from(actual))}`);
      }
    }
  } finally { await shell.dispose(); }
}

export async function verifyFactorCommands(entry = defaultEntry) {
  const filesystem = new entry.MemoryFileSystem();
  const encoder = new TextEncoder();
  await filesystem.mkdir("/factor-work");
  await filesystem.writeFile("/factor-work/args.sh", encoder.encode('factor -- "$@"\n'));
  await filesystem.writeFile("/factor-work/stdin.sh", encoder.encode('factor < "$1"\n'));
  const cases = [
    ["args", "sh args.sh 0 1 2 12 360 97", "", 0, "0:\n1:\n2: 2\n12: 2 2 3\n360: 2 2 2 3 3 5\n97: 97\n", ""],
    ["stdin", "sh stdin.sh stdin", "\n0 1\t12\n+18 00025  \n", 0, "0:\n1:\n12: 2 2 3\n18: 2 3 3\n25: 5 5\n", ""],
    ["invalid", "sh args.sh 12 bad 18 -bad", "", 1, "12: 2 2 3\n18: 2 3 3\n", "factor: 'bad' is not a valid positive integer\nfactor: '-bad' is not a valid positive integer\n"],
    ["nul", "sh stdin.sh nul", "12\0junk 18\n", 0, "12: 2 2 3\n18: 2 3 3\n", ""],
    ["ceiling", "sh args.sh 4294967296 12", "", 1, "12: 2 2 3\n", "factor: '4294967296' exceeds supported maximum 4294967295\n"],
  ];
  const shell = new entry.Shell({ fs: filesystem, cwd: "/factor-work", env: { LC_ALL: "C", TZ: "UTC" } }).use(entry.agentCommands());
  try {
    if (entry.createFactorCommand().name !== "factor") throw new Error("Public factor factory is missing");
    if (entry.createFactorCommand !== createSubpathFactorCommand || entry.createFactorCommands !== createSubpathFactorCommands || entry.factorCommands !== subpathFactorCommands) throw new Error("Factor subpath factory identity differs");
    for (const [name, script, input, status, stdout, stderr] of cases) {
      await filesystem.writeFile(`/factor-work/${name}`, encoder.encode(input));
      const result = await shell.exec(script);
      if (result.exitCode !== status) throw new Error(`Public factor ${name} status differs: ${result.exitCode}`);
      for (const [stream, expected] of [["stdoutBytes", encoder.encode(stdout)], ["stderrBytes", encoder.encode(stderr)]]) {
        const actual = result[stream];
        if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) throw new Error(`Public factor ${name} ${stream} differs: ${JSON.stringify(Array.from(actual))}`);
      }
    }
    shell.use(entry.factorCommands({ replace: true, limits: { maxValue: 100 } }));
    const limited = await shell.exec("sh args.sh 100 101 12");
    if (limited.exitCode !== 1 || limited.stdout !== "100: 2 2 5 5\n12: 2 2 3\n" || limited.stderr !== "factor: '101' exceeds supported maximum 100\n") throw new Error(`Public factor configured cap failed: ${JSON.stringify(limited)}`);
    let invalidLimit;
    try { entry.createFactorCommand({ limits: { maxValue: 4294967296 } }); }
    catch (error) { invalidLimit = error; }
    if (invalidLimit?.name !== "RangeError") throw new Error("Public factor allowed a limit above its supported maximum");
  } finally { await shell.dispose(); }
}

export async function verifyGetoptCommands(entry = defaultEntry) {
  const filesystem = new entry.MemoryFileSystem();
  const encoder = new TextEncoder();
  await filesystem.mkdir("/getopt-work");
  await filesystem.writeFile("/getopt-work/normalize.sh", encoder.encode('getopt "$@"\n'));
  await filesystem.writeFile("/getopt-work/roundtrip.sh", encoder.encode(
    'parsed=$(getopt -o "" -- "$@") || exit "$?"\neval "set -- $parsed"\nshift\nprintf \'<%s>\\n\' "$@"\n',
  ));
  await filesystem.writeFile("/getopt-work/raw.sh", encoder.encode(
    'raw=$(cat raw-second; printf .)\nraw=${raw%.}\ngetopt -o "" -- "$(cat raw-first)" "$raw"\n',
  ));
  await filesystem.writeFile("/getopt-work/mapfile.sh", encoder.encode(
    'callback() { sh roundtrip.sh "$2"; }\nmapfile -t -C callback -c 1 rows < raw-first\n',
  ));
  await filesystem.writeFile("/getopt-work/raw-first", Uint8Array.of(128, 255));
  await filesystem.writeFile("/getopt-work/raw-second", Uint8Array.of(97, 39, 255, 92, 10));
  const quotedArguments = "'' 'a b' \"O'Reilly\" 'line\nnext' 'tab\there' '\\$`!\";$(nothing)'";
  const cases = [
    ["enhanced", "sh normalize.sh -o ab:c:: --long alpha,beta:,color:: -- pre --alph -b value --color -- -a ''", 0, " --alpha -b 'value' --color '' -- 'pre' '-a' ''\n", ""],
    ["quoted", `sh normalize.sh -o '' -- ${quotedArguments}`, 0, " -- '' 'a b' 'O'\\''Reilly' 'line\nnext' 'tab\there' '\\$`!\";$(nothing)'\n", ""],
    ["invalid", "sh normalize.sh -o ab -- -axb --unknown tail", 1, " -a -b -- 'tail'\n", "getopt: invalid option -- 'x'\ngetopt: unrecognized option '--unknown'\n"],
    ["test", "sh normalize.sh -T", 4, "", ""],
    ["roundtrip", `sh roundtrip.sh ${quotedArguments}`, 0, "<>\n<a b>\n<O'Reilly>\n<line\nnext>\n<tab\there>\n<\\$`!\";$(nothing)>\n", ""],
  ];
  const shell = new entry.Shell({ fs: filesystem, cwd: "/getopt-work", env: { LC_ALL: "C", TZ: "UTC" } }).use(entry.agentCommands());
  try {
    if (entry.createGetoptCommand().name !== "getopt") throw new Error("Public getopt factory is missing");
    if (entry.createGetoptCommand !== createSubpathGetoptCommand || entry.createGetoptCommands !== createSubpathGetoptCommands || entry.getoptCommands !== subpathGetoptCommands) throw new Error("Getopt subpath factory identity differs");
    for (const [name, script, status, stdout, stderr] of cases) {
      const result = await shell.exec(script);
      if (result.exitCode !== status) throw new Error(`Public getopt ${name} status differs: ${result.exitCode}`);
      for (const [stream, expected] of [["stdoutBytes", encoder.encode(stdout)], ["stderrBytes", encoder.encode(stderr)]]) {
        const actual = result[stream];
        if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) throw new Error(`Public getopt ${name} ${stream} differs: ${JSON.stringify(Array.from(actual))}`);
      }
    }
    const internalErrors = [];
    const raw = await shell.exec("sh raw.sh", { onInternalError(error) { internalErrors.push(String(error)); } });
    const rawExpected = Uint8Array.of(32, 45, 45, 32, 39, 128, 255, 39, 32, 39, 97, 39, 92, 39, 39, 255, 92, 10, 39, 10);
    if (raw.exitCode !== 0 || raw.stderrBytes.length !== 0 || raw.stdoutBytes.length !== rawExpected.length || raw.stdoutBytes.some((value, index) => value !== rawExpected[index])) throw new Error(`Public getopt raw bytes changed: ${JSON.stringify({ status: raw.exitCode, stdout: Array.from(raw.stdoutBytes), stderr: Array.from(raw.stderrBytes), internalErrors })}`);
    const rawRoundtrip = await shell.exec('sh roundtrip.sh "$(cat raw-first)"');
    const roundtripExpected = Uint8Array.of(60, 128, 255, 62, 10);
    if (rawRoundtrip.exitCode !== 0 || rawRoundtrip.stderrBytes.length !== 0 || rawRoundtrip.stdoutBytes.length !== roundtripExpected.length || rawRoundtrip.stdoutBytes.some((value, index) => value !== roundtripExpected[index])) throw new Error(`Public getopt eval roundtrip changed raw operand bytes: ${JSON.stringify({ status: rawRoundtrip.exitCode, stdout: Array.from(rawRoundtrip.stdoutBytes), stderr: Array.from(rawRoundtrip.stderrBytes) })}`);
    const rawForwarded = await shell.exec("cat raw-first | xargs -0 sh roundtrip.sh");
    if (rawForwarded.exitCode !== 0 || rawForwarded.stderrBytes.length !== 0 || rawForwarded.stdoutBytes.length !== roundtripExpected.length || rawForwarded.stdoutBytes.some((value, index) => value !== roundtripExpected[index])) throw new Error(`Public getopt xargs roundtrip changed raw operand bytes: ${JSON.stringify({ status: rawForwarded.exitCode, stdout: Array.from(rawForwarded.stdoutBytes), stderr: Array.from(rawForwarded.stderrBytes) })}`);
    const rawCallback = await shell.exec("sh mapfile.sh");
    if (rawCallback.exitCode !== 0 || rawCallback.stderrBytes.length !== 0 || rawCallback.stdoutBytes.length !== roundtripExpected.length || rawCallback.stdoutBytes.some((value, index) => value !== roundtripExpected[index])) throw new Error(`Public getopt mapfile roundtrip changed raw operand bytes: ${JSON.stringify({ status: rawCallback.exitCode, stdout: Array.from(rawCallback.stdoutBytes), stderr: Array.from(rawCallback.stderrBytes) })}`);
    shell.use(entry.getoptCommands({ replace: true, limits: { maxWork: 1 } }));
    const limited = await shell.exec("sh normalize.sh -o ''");
    if (limited.exitCode !== 3 || limited.stdoutBytes.length !== 0 || limited.stderr !== "getopt: work limit exceeded\n") throw new Error(`Public getopt work cap failed: ${JSON.stringify(limited)}`);
    let invalidLimit;
    try { entry.createGetoptCommand({ limits: { maxWork: 0 } }); }
    catch (error) { invalidLimit = error; }
    if (invalidLimit?.name !== "RangeError") throw new Error("Public getopt accepted an invalid work limit");
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
