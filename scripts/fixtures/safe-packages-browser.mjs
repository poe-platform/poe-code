import { verification as docxVerification } from "./safe-packages-docx.mjs";
await docxVerification;
import { verification as fileVerification } from "./safe-packages-file.mjs";
await fileVerification;
import { verification as hexdumpVerification } from "./safe-packages-hexdump.mjs";
await hexdumpVerification;
import { verification as duVerification } from "./safe-packages-du.mjs";
await duVerification;
import { verification as timeoutVerification } from "./safe-packages-timeout-portable.mjs";
await timeoutVerification;
import { verifyCmp } from "./safe-packages-cmp.mjs";
await verifyCmp({ portable: true });
import "./safe-packages-bzip2.mjs";
import { verifyCp } from "./safe-packages-cp.mjs";
await verifyCp();
import { verification as gzipVerification } from "./safe-packages-gzip.mjs";
await gzipVerification;
import { verification as xqVerification } from "./safe-packages-xq.mjs";
await xqVerification;
import "./safe-packages-wget.mjs";
import { verification as tarVerification } from "./safe-packages-tar.mjs";
await tarVerification;
import { verification as selectedSpreadsheetVerification } from "./safe-packages-ssconvert-scoped.mjs";
await selectedSpreadsheetVerification;
import "./safe-packages-command-errors.mjs";
import "./safe-packages-xml-portable.mjs";
import "./safe-packages-command-exports.mjs";
import { Shell, agentCommands, createAgentCommands, createMemoryFileSystem, evaluateCommandSupport, FsError, createBoundedRegexProvider } from "@poe-platform/safe-bash";
import { checksumWorkflows, expectedAgentCommandNames, nullDeviceWorkflows, runNestedCommands, verifyCmpCommands, verifyFmtCommands, verifyShufCommands, verifyNumfmtCommands, verifyTruncateCommands, verifyZipCommands, verifyCsplitCommands, verifyPrCommands, verifyTsortCommands, verifyFactorCommands, verifyGetoptCommands, verifyHexdumpCommands, verifyMdqCommands, verifyNullDeviceView } from "./safe-packages-mixed-entry-runtime.mjs";
import { FsError as CoreFsError, createDeviceFileSystem } from "@poe-platform/safe-fs/core";
import { FsError as CompatibilityFsError } from "@poe-platform/safe-js/fs/core";
import "./safe-packages-response-body-mode.mjs";
import "./safe-packages-atomic.mjs";
import "./safe-packages-mkdir.mjs";

const browserCore = await import("@poe-platform/safe-bash");
for (const name of ["arraysExtension", "jobsExtension", "trapExtension"]) {
  if (Object.hasOwn(browserCore, name)) throw new Error(`Optional factory entered the browser core: ${name}`);
}
for (const name of ["mapfileExtension", "readExtension", "createCallerCommand", "createYesCommand", "createDdCommand", "createShufCommand", "createCmpCommand", "createTruncateCommand", "createInstallCommand"]) {
  if (typeof browserCore[name] !== "function") throw new Error(`Browser command factory is missing: ${name}`);
}
if (typeof browserCore.createYqCommand !== "function") throw new Error("Restricted core YAML/TOML factory is missing");

if (FsError !== CoreFsError) throw new Error("Browser filesystem identity diverged");
if (FsError !== CompatibilityFsError) throw new Error("Compatibility filesystem identity diverged");
await verifyNullDeviceView({ createMemoryFileSystem, createDeviceFileSystem });
await verifyCmpCommands();
await verifyFmtCommands();
await verifyShufCommands();
await verifyNumfmtCommands();
await verifyTruncateCommands();
await verifyZipCommands();
await verifyCsplitCommands();
await verifyPrCommands();
await verifyTsortCommands();
await verifyFactorCommands();
await verifyGetoptCommands();
await verifyHexdumpCommands();
await verifyMdqCommands();
const definitions = createAgentCommands();
const commandNames = definitions.map(command => command.name).sort();
if (JSON.stringify(commandNames) !== JSON.stringify(expectedAgentCommandNames)) {
  throw new Error(`Default browser command inventory differs: ${JSON.stringify(commandNames)}`);
}
const declaredCommands = [
  "[", "basename", "cat", "cmp", "cp", "csplit", "cut", "dirname", "echo", "false", "fd", "fmt", "grep", "head", "install", "ln", "ls",
  "mkdir", "mv", "numfmt", "printf", "pwd", "readlink", "realpath", "rg", "rm", "rmdir", "sed", "shuf", "sort",
  "tail", "tee", "test", "touch", "tr", "true", "truncate", "uniq", "wc",
];
const declaredNames = definitions.filter(definition => Object.hasOwn(definition, "filesystemRequirements")).map(definition => definition.name).sort();
if (JSON.stringify(declaredNames) !== JSON.stringify(declaredCommands)) throw new Error(`Default browser filesystem requirement declarations changed: ${JSON.stringify(declaredNames)}`);
for (const definition of definitions.filter(definition => !Object.hasOwn(definition, "filesystemRequirements"))) {
  const support = evaluateCommandSupport(definition, { readOnly: true });
  if (support.declared || support.status !== "partial" || support.modes.length) throw new Error(`Undeclared browser command support became optimistic: ${definition.name}`);
}
for (const [name, expected] of [["printf", "supported"], ["mkdir", "unsupported"], ["csplit", "unsupported"], ["tee", "partial"], ["truncate", "unsupported"]]) {
  const definition = definitions.find(command => command.name === name);
  if (!definition || evaluateCommandSupport(definition, { readOnly: true }).status !== expected) {
    throw new Error(`Browser filesystem capability evaluation failed: ${name}`);
  }
}
const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
try {
  const result = await shell.exec("printf 'b\\na\\n' | sort");
  if (result.exitCode !== 0 || result.stdout !== "a\nb\n") throw new Error("Browser shell smoke failed");
  for (const [script, expected] of [
    ...checksumWorkflows,
    ...nullDeviceWorkflows,
    ['arr=(10 20); (( arr[0] += 1 )); echo "${arr[0]}"', "11\n"],
    ['declare -A map; map[key]=value; echo "${map[key]}"', "value\n"],
    ["read -r value <<<'read'; printf '%s\\n' \"$value\"", "read\n"],
    ["mapfile -t rows <<<'row'; printf '<%s>\\n' \"${rows[@]}\"", "<row>\n"],
    ['eval "echo hi"', "hi\n"],
    ['echo "hello" | cut -c1-2', "he\n"],
    ['tar --help > /tar-help; test -s /tar-help', ""],
    ["printf 'a,b\\nc,d\\n' | cut -d , -f 2", "b\nd\n"],
    ["printf 'a\\tb\\tc\\n' | cut -f 1,3", "a\tc\n"],
    ["printf 'a,,c\\n,b,\\n' > /fields; cut -d , -f 2,3 /fields", ",c\nb,\n"],
  ]) {
    const output = await shell.exec(script);
    if (output.exitCode !== 0 || output.stderr !== "" || output.stdout !== expected) {
      throw new Error(`Browser shell smoke failed: ${script}: ${JSON.stringify(output)}`);
    }
  }
} finally { await shell.dispose(); }

for (const regexExecutor of [undefined, createBoundedRegexProvider()]) {
  const search = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor }));
  try {
    const result = await search.exec("printf 'first\\nsecond\\n' | grep -E '^(first|second)$' | rg -F second | sed 's/second/done/'");
    if (result.exitCode !== 0 || result.stderr !== "" || result.stdout !== "done\n") {
      throw new Error(`Production default search smoke failed: ${JSON.stringify(result)}`);
    }
    for (const [script, expected] of [
      ["printf 'giraffe giraffe\\n' | grep -o giraffe", "giraffe\ngiraffe\n"],
      ["printf 'zab ab\\n' | grep -Eo 'a|ab'", "ab\nab\n"],
      ["printf 'é🦊é🦊\\n' | grep -Fo 'é🦊'", "é🦊\né🦊\n"],
      ["printf '<div class=\"section-title\">⚽ Alternate Plan: Football Fans</div>\\n' > /day5.html; grep -n section-title /day5.html", "1:<div class=\"section-title\">⚽ Alternate Plan: Football Fans</div>\n"],
      ["LC_ALL=C grep -n 'Alternate Plan' /day5.html", "1:<div class=\"section-title\">⚽ Alternate Plan: Football Fans</div>\n"],
      ["printf 'é🦊first café second\\n' | grep -Eo 'first|second'", "first\nsecond\n"],
      ["printf 'GiRaFfE é🦊\\nother\\n' | grep -in giraffe", "1:GiRaFfE é🦊\n"],
      ["printf 'éA+b😀a+B\\n' | grep -Fio 'a+b'", "A+b\na+B\n"],
      ["printf 'AbCDEé😀abc\\n' | grep -Eio '[^a-c]+'", "DEé😀\n"],
      ["printf 'éA+b😀a+B\\n' | grep -io 'a+b'", "A+b\na+B\n"],
      ["printf 'axb a.b\\n' | grep -o 'a\\.b'", "a.b\n"],
      ["printf 'a (a) +\\n' | grep -o '[()+]'", "(\n)\n+\n"],
    ]) {
      const extracted = await search.exec(script);
      if (extracted.exitCode !== 0 || extracted.stderr !== "" || extracted.stdout !== expected) {
        throw new Error(`Production grep extraction failed: ${script}: ${JSON.stringify(extracted)}`);
      }
    }
  } finally { await search.dispose(); }
}
const nested = await runNestedCommands();
if (nested.failures.length) throw new Error(`Nested browser dispatch errors: ${nested.failures.join(", ")}`);
for (const result of nested.results) {
  if (result.exitCode !== 0 || result.stderr !== "" || result.stdout !== "2\n") {
    throw new Error(`Nested browser dispatch failed: ${JSON.stringify(result)}`);
  }
}

import { verifyIconvCommands } from "./safe-packages-iconv.mjs";
await verifyIconvCommands();

import { verifyLineEndingCommands } from "./safe-packages-line-endings.mjs";
import { verifyLlmCommands } from "./safe-packages-llm.mjs";
await verifyLlmCommands();
import { verifyLlmCollections } from "./safe-packages-llm-collections.mjs";
await verifyLlmCollections();
await verifyLineEndingCommands();

await (await import("./safe-packages-pr.mjs")).verification;

await (await import("./safe-packages-csplit.mjs")).verification;

await (await import("./safe-packages-diff.mjs")).verification;

await (await import("./safe-packages-split.mjs")).verification;

await (await import("./safe-packages-op.mjs")).verification;
