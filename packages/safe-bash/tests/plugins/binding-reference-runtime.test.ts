import assert from "node:assert/strict";
import { describe, test } from "node:test";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = { arraysExtension(): Extension; readExtension(): Extension };

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

const cases: readonly { name: string; source: string; stdout: string; diagnostic?: string; binding?: { name: string; kind: "unset" | "scalar" | "indexed" } }[] = [
  {
    name: "whole scalar unbind removes presence",
    source: `value=old; reference unbind value; printf 'set:%s\\n' "\${value+x}"`,
    stdout: "set:\n",
  },
  {
    name: "bracketed whole-name unbind does not remove an element",
    source: `read -a values <<< 'left right'; reference unbind 'values[1]'; printf '%s:%s\\n' "\${values[0]}" "\${values[1]}"`,
    stdout: "left:right\n",
    binding: { name: "values", kind: "indexed" },
  },
  {
    name: "integer assignment replaces a scalar",
    source: `value=old; reference assign value 17; printf '%s\\n' "$value"`,
    stdout: "17\n",
  },
  {
    name: "integer assignment preserves neighboring indexed slots",
    source: `read -a values <<< 'left right'; reference assign 'values[1]' 17; printf '%s:%s\\n' "\${values[0]}" "\${values[1]}"`,
    stdout: "left:17\n",
    binding: { name: "values", kind: "indexed" },
  },
  {
    name: "local unset and assignment preserve outer restoration",
    source: `value=outer; function collect() { local value=old; reference unbind value; printf '<%s>' "\${value+x}"; reference assign value 17; printf '<%s>\\n' "$value"; }; collect; printf '%s\\n' "$value"`,
    stdout: "<><17>\nouter\n",
  },
  {
    name: "readonly unbind reports refusal without mutation",
    source: `readonly value=old; reference unbind value; printf 'status:%s;value:%s\\n' "$?" "$value"`,
    stdout: "status:1;value:old\n",
    diagnostic: "value: cannot unset: readonly variable",
  },
  {
    name: "invalid reference reports syntax failure without mutation",
    source: `value=old; reference unbind '9bad'; printf 'status:%s;value:%s\\n' "$?" "$value"`,
    stdout: "status:1;value:old\n",
    diagnostic: "`9bad': not a valid identifier",
  },
  {
    name: "whole indexed-name unbind removes all slots",
    source: `read -a values <<< 'left right'; reference unbind values; printf '%s:%s\\n' "\${values[0]}" "\${values[1]}"`,
    stdout: ":\n",
    binding: { name: "values", kind: "unset" },
  },
];

describe("compiled generic reference-binding contract", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const route of ["inline", "bash", "sh"] as const) {
    for (const record of cases) {
      test(`${route}: ${record.name}`, async context => {
        const published = await import("poe-code/safe-bash");
        const { createMemoryFileSystem } = await import("poe-code/safe-fs");
        const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
        const resources: { shell?: import("poe-code/safe-bash").Shell } = {};
        context.after(() => resources.shell?.dispose());
        const referenceExtension: Extension = {
          name: "reference-consumer",
          runtimeIdentity: published.commandRuntimeIdentity,
          create: () => ({
            builtins: [{
              name: "reference",
              async execute(invocation) {
                const operation = invocation.args[0];
                assert.ok(operation === "unbind" || operation === "assign");
                const prepared = await invocation.bindings.prepareReference(invocation.argumentValues[1]!);
                if (!prepared.ok) {
                  await invocation.diagnostic(prepared.diagnostic);
                  return 1;
                }
                try {
                  const outcome = operation === "unbind"
                    ? await prepared.value.unbindName()
                    : await prepared.value.assignInteger(Number(invocation.args[2]));
                  if (!outcome.ok) {
                    await invocation.diagnostic(outcome.diagnostic);
                    return 1;
                  }
                  if (record.binding) assert.equal(invocation.bindings.describe(record.binding.name).kind, record.binding.kind);
                  return 0;
                } finally { await prepared.value.close(); }
              },
            }],
          }),
        };
        const fs = createMemoryFileSystem();
        const shell = new published.Shell({
          fs,
          extensions: [optional.arraysExtension(), optional.readExtension(), referenceExtension],
          limits: { maxWallClockMs: 2000, maxOutputBytes: 65536, maxCommands: 128 },
        });
        resources.shell = shell;
        shell.use(published.agentCommands());
        if (route !== "inline") await fs.writeFile("/reference-bindings.sh", new TextEncoder().encode(record.source));
        const source = route === "inline" ? record.source : `${route} /reference-bindings.sh`;
        const result = await shell.exec(source, { env: { LC_ALL: "C" } });
        const diagnosticName = route === "inline" ? "shell" : "/reference-bindings.sh";
        const stderr = record.diagnostic === undefined ? "" : `${diagnosticName}: line 1: ${record.diagnostic}\n`;
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(record.stdout), result.stderr);
        assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(stderr), result.stderr);
      });
    }
  }
});
