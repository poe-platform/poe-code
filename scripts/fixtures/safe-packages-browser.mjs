import { Shell, agentCommands, createAgentCommands, createMemoryFileSystem, evaluateCommandSupport, FsError, createBoundedRegexProvider } from "@poe-platform/safe-bash";
import { checksumWorkflows, expectedAgentCommandNames, nullDeviceWorkflows, runNestedCommands, verifyCmpCommands, verifyFmtCommands, verifyShufCommands, verifyNumfmtCommands, verifyTruncateCommands, verifyZipCommands, verifyCsplitCommands, verifyPrCommands, verifyTsortCommands, verifyFactorCommands, verifyGetoptCommands, verifyHexdumpCommands, verifyNullDeviceView } from "./safe-packages-mixed-entry-runtime.mjs";
import { FsError as CoreFsError, createDeviceFileSystem } from "@poe-platform/safe-fs/core";
import { FsError as CompatibilityFsError } from "@poe-platform/safe-js/fs/core";
import "./safe-packages-response-body-mode.mjs";

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
const definitions = createAgentCommands();
const commandNames = definitions.map(command => command.name).sort();
if (JSON.stringify(commandNames) !== JSON.stringify(expectedAgentCommandNames)) {
  throw new Error(`Default browser command inventory differs: ${JSON.stringify(commandNames)}`);
}
const declaredCommands = [
  "[", "basename", "cat", "cmp", "cp", "cut", "dirname", "echo", "false", "fmt", "grep", "head", "ln", "ls",
  "mkdir", "mv", "numfmt", "printf", "pwd", "readlink", "realpath", "rg", "rm", "rmdir", "sed", "shuf", "sort",
  "tail", "tee", "test", "touch", "tr", "true", "truncate", "uniq", "wc",
];
const declaredNames = definitions.filter(definition => Object.hasOwn(definition, "filesystemRequirements")).map(definition => definition.name).sort();
if (JSON.stringify(declaredNames) !== JSON.stringify(declaredCommands)) throw new Error("Default browser filesystem requirement declarations changed");
for (const definition of definitions.filter(definition => !Object.hasOwn(definition, "filesystemRequirements"))) {
  const support = evaluateCommandSupport(definition, { readOnly: true });
  if (support.declared || support.status !== "partial" || support.modes.length) throw new Error(`Undeclared browser command support became optimistic: ${definition.name}`);
}
for (const [name, expected] of [["printf", "supported"], ["mkdir", "unsupported"], ["tee", "partial"], ["truncate", "unsupported"]]) {
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
    ["printf 'a,b\\nc,d\\n' | cut -d , -f 2", "b\nd\n"],
    ["printf 'a\\tb\\tc\\n' | cut -f 1,3", "a\tc\n"],
    ["printf 'a,,c\\n,b,\\n' > /fields; cut -d , -f 2,3 /fields", ",c\nb,\n"],
  ]) {
    const output = await shell.exec(script);
    if (output.exitCode !== 0 || output.stderr !== "" || output.stdout !== expected) {
      throw new Error(`Browser cut smoke failed: ${script}: ${JSON.stringify(output)}`);
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
