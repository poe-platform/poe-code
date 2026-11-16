import assert from "node:assert/strict";
import test from "node:test";
import {Shell, createMemoryFileSystem, agentCommands} from "../../src/index.js";

// GNU Bash 5.3 controls for explicit array declarations.
const cases = [
  {
    "name": "original",
    "source": "IFS=:; declare -a IFS; v=\"a:b c\"; printf \"<%s>\" $v; IFS=,; v=\"d,e f\"; printf \"<%s>\" $v; set -- a b; printf \"|%s|\" \"$*\"",
    "stdout": "<a:b c><d,e f>|ab|",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "bare-join",
    "source": "IFS=:; declare -a IFS; set -- a b; printf \"<%s>\" \"$*\"",
    "stdout": "<ab>",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "array-join",
    "source": "IFS=:; declare -a IFS; a=(one two); printf \"<%s>|<%s>\" \"${a[*]}\" \"${!a[*]}\"",
    "stdout": "<onetwo>|<01>",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "scalar-preserved",
    "source": "IFS=:; declare -a IFS; printf \"<%s>\" \"${IFS[0]}\"",
    "stdout": "<:>",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "typeset",
    "source": "IFS=:; typeset -a IFS; value=\"a:b c\"; printf \"<%s>\" $value",
    "stdout": "<a:b c>",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "local",
    "source": "IFS=:; f() { local -a IFS; v=\"a:b c\"; printf \"<%s>\" $v; }; f; v=a:b; printf \"<%s>\" $v",
    "stdout": "<a:b c><a><b>",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "read",
    "source": "IFS=:; declare -a IFS; read first second <<< \"a:b c\"; printf \"<%s><%s>\" \"$first\" \"$second\"",
    "stdout": "<a:b c><>",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "positional",
    "source": "IFS=:; declare -a IFS; set -- \"a:b\" \"c d\"; printf \"<%s>\" $@",
    "stdout": "<a:b><c d>",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "unset",
    "source": "IFS=:; declare -a IFS; unset IFS; set -- a b; printf \"<%s>\" \"$*\"",
    "stdout": "<a b>",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "scalar-control",
    "source": "IFS=:; value=\"a:b c\"; printf \"<%s>\" $value; set -- a b; printf \"<%s>\" \"$*\"",
    "stdout": "<a><b c><a:b>",
    "stderr": "",
    "exitCode": 0
  },
  {
    "name": "other-scalar",
    "source": "value=kept; declare -a value; printf \"<%s>\" \"${value[0]}\"",
    "stdout": "<kept>",
    "stderr": "",
    "exitCode": 0
  }
];
for (const entry of cases) {
  test(`declared array IFS: ${entry.name}`, async context => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({fs, cwd:"/"}).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(entry.source, {env:{LC_ALL:"C"}});
    assert.deepEqual([result.stdout,result.stderr,result.exitCode], [entry.stdout,entry.stderr,entry.exitCode]);
  });
}
