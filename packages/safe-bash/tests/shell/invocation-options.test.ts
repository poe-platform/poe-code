import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

const names = ["allexport", "braceexpand", "errexit", "noclobber", "noexec", "noglob", "nounset", "pipefail"];
for (const command of ["bash", "sh"]) for (const [name, flag] of [["allexport", "a"], ["noglob", "f"], ["noclobber", "C"], ["errexit", "e"], ["nounset", "u"], ["braceexpand", "B"], ["pipefail", undefined]] as const) {
  for (const mode of ["string", "stdin", "file"]) test(`${command} ${name} via ${mode}`, async context => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs }).use(agentCommands());
    context.after(() => shell.dispose());
    const source = `[[ -o ${name} ]]; printf '%s' "$?"`;
    await fs.writeFile("/script", new TextEncoder().encode(source));
    const invoke = (options: string) => mode === "string" ? `${command} ${options} -c '${source}'` : mode === "file" ? `${command} ${options} /script` : `printf '%s' '${source}' | ${command} ${options} -s`;
    for (const options of [`-o ${name}`, ...(flag ? [`-${flag}`] : [])]) {
      assert.equal((await shell.exec(invoke(options))).stdout, "0");
      const disabled = await shell.exec(invoke(`${options} +o ${name}`));
      assert.equal(disabled.stdout, "1");
      assert.equal(disabled.stderr, "");
      if (flag) assert.equal((await shell.exec(invoke(`${options} +${flag}`))).stdout, "1");
    }
  });
}
test("shopt exposes the complete set namespace", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const listed = await shell.exec("shopt -op");
  for (const name of names) assert.ok(listed.stdout.includes(`o ${name}\n`));
  assert.equal(listed.stderr, "");
  const changed = await shell.exec("shopt -os allexport; shopt -oq allexport; printf '%s' \"$?\"; shopt -ou allexport; shopt -oq allexport; printf '%s' \"$?\"; shopt -op noexec");
  assert.equal(changed.stdout, "01set +o noexec\n");
  assert.equal(changed.stderr, "");
});
test("invocation options affect execution", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("bash -o errexit -c 'false; echo bad'")).exitCode, 1);
  assert.equal((await shell.exec("bash -o pipefail -c 'false | true'")).exitCode, 1);
  assert.equal((await shell.exec(`bash -a -c 'VALUE=hello; sh -c '\\''printf %s "$VALUE"'\\'''`)).stdout, "hello");
  assert.equal((await shell.exec("bash -o noexec -c 'echo bad'")).stdout, "");
});
