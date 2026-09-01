import assert from "node:assert/strict";
import { test } from "node:test";
import { runVirtualScript } from "../shell-stress/helpers.js";

for (const expansion of ["${VALUE:?stop}", "$((1/0))"]) {
  for (const operator of ["heredoc", "here-string"]) {
    const redirect = operator === "heredoc" ? `<<EOF\n${expansion}\nEOF\n` : `<<<"${expansion}"\n`;
    for (const [name, command, isolated] of [
      ["builtin", "printf ran", false],
      ["function", "func", false],
      ["brace group", "{ printf ran >executed; }", false],
      ["redirect only", "", false],
      ["external command", "cat", true],
      ["subshell redirect", "( printf ran >executed; )", true],
    ] as const) {
      test(`${operator} failure scope: ${name} ${expansion}`, async () => {
        const fixture = {
          name: `${operator} failure scope: ${name}`,
          script: `func() { printf ran >executed; }; ${command} 2>errors ${redirect}status=$?; printf after >marker; exit "$status"`,
        };
        const actual = await runVirtualScript(fixture);
        const fatal = expansion.startsWith("${") && !isolated;
        const files = fatal ? ["errors"] : ["errors", "marker"];
        assert.equal(actual.exitCode, expansion.startsWith("${") ? 127 : 1);
        for (const observation of [actual]) {
          assert.equal(observation.stdout, "");
          assert.equal(observation.stderr, "");
          assert.deepEqual(Object.keys(observation.files).sort(), files);
          if (!fatal) assert.deepEqual(observation.files.marker, { type: "file", base64: Buffer.from("after").toString("base64") });
          const diagnostic = observation.files.errors;
          assert.ok(diagnostic?.type === "file");
          assert.match(Buffer.from(diagnostic.base64!, "base64").toString(), expansion.startsWith("${") ? /VALUE: stop/u : /division by (?:0|zero)/iu);
        }
      });
    }
  }
}

for (const operator of ["heredoc", "here-string"]) {
  const redirect = operator === "heredoc" ? "<<EOF\n${VALUE:?stop}\nEOF\n" : '<<<"${VALUE:?stop}"\n';
  for (const [name, wrap, stdout, status] of [
    ["subshell", (body: string) => `( ${body} );`, "", 1],
    ["pipeline", (body: string) => `{ ${body} } | cat;`, "", 0],
    ["substitution", (body: string) => `value=$( ${body} );`, "", 1],
  ] as const) {
    test(`${operator} parameter failure aborts only its ${name} environment`, async () => {
      const body = `printf ran 2>errors ${redirect}printf bad >inner;`;
      const fixture = { name: `${operator} nested fatal ${name}`, script: `${wrap(body)} status=$?; printf after >outer; exit "$status"` };
      const actual = await runVirtualScript(fixture);
      assert.equal(actual.exitCode, status);
      for (const observation of [actual]) {
        assert.equal(observation.stdout, stdout);
        assert.equal(observation.stderr, "");
        assert.deepEqual(Object.keys(observation.files).sort(), ["errors", "outer"]);
        assert.deepEqual(observation.files.outer, { type: "file", base64: Buffer.from("after").toString("base64") });
      }
    });
  }
}
