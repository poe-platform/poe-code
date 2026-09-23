import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { Shell } from "../../../src/shell/index.js";
import { networkCommands } from "../../../src/commands/network/index.js";
import { fixture, run, server } from "./helpers.js";

const payload = Buffer.from([82, 101, 252, 0, 10]);

for (const flag of ["-F", "--form"]) {
  for (const prefix of ["@", "<"]) {
    for (const path of ["input.dat", "space input.dat", "semi;comma,input.dat", 'quote"input.dat', "back\\slash.dat"]) {
      test(`curl ${flag} parses quoted ${prefix} operand ${path}`, async () => {
        const host = await server();
        const fs = await fixture();
        await fs.writeFile(`/work/${path}`, payload);
        const operand = path.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
        const shell = new Shell({ fs, cwd: "/work" }).use(networkCommands({ authorize: request => new URL(request.url).origin === host.origin }));
        try {
          const result = await shell.exec(`curl -s ${flag} 'field=${prefix}"${operand}";type=application/octet-stream' '${host.origin}/echo'`);
          assert.equal(result.exitCode, 0, result.stderr);
          const body = host.requests[0]!.body;
          assert.ok(body.includes(payload));
          const headers = body.subarray(0, body.indexOf("\r\n\r\n")).toString();
          assert.ok(headers.includes('name="field"'));
          assert.equal(headers.includes("filename="), prefix === "@");
          if (prefix === "@") assert.ok(headers.includes(`filename="${operand}"`));
          assert.ok(headers.includes("Content-Type: application/octet-stream"));
          assert.deepEqual(Buffer.from(await fs.readFile(`/work/${path}`)), payload);
        } finally { await shell.dispose(); await host.close(); }
      });
    }
  }
}

test("curl decodes quoted filename overrides and preserves non-special backslashes", async () => {
  const host = await server();
  const fs = await fixture();
  await fs.writeFile("/work/input.dat", payload);
  try {
    for (const filename of ['"changed;output, name.dat"', String.raw`"quote\"and\\slash\q.dat"`]) {
      const result = await run(["-F", `field=@input.dat;filename=${filename}`, host.origin + "/echo"], { fs });
      assert.equal(result.exitCode, 0, result.stderr.toString());
      const body = host.requests.at(-1)!.body;
      const expected = filename.startsWith('"changed') ? "changed;output, name.dat" : String.raw`quote\"and\\slash\\q.dat`;
      assert.ok(body.includes(`filename="${expected}"`), body.toString());
      assert.ok(body.includes(payload));
    }
  } finally { await host.close(); }
});

test("quoted stdin form operands and form-string retain their distinct meaning", async () => {
  const host = await server();
  try {
    const stdin = await run(["-F", 'field=@"-";filename="stdin;data.dat"', host.origin + "/echo"], { stdin: payload });
    assert.equal(stdin.exitCode, 0, stdin.stderr.toString());
    assert.ok(host.requests[0]!.body.includes(payload));
    assert.ok(host.requests[0]!.body.includes('filename="stdin;data.dat"'));
    const literal = '@"missing;file.dat";filename="literal"';
    const result = await run(["--form-string", `field=${literal}`, host.origin + "/echo"]);
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.ok(host.requests[1]!.body.includes(literal));
  } finally { await host.close(); }
});


test("quoted stdin operands and semicolon filenames agree with native curl", async () => {
  const host = await server();
  try {
    for (const prefix of ["@", "<"]) {
      const args = ["-sS", "-F", `field=${prefix}"-"${prefix === "@" ? ';filename="changed;output.dat"' : ""};type=application/octet-stream`, host.origin + "/echo"];
      const actual = await run(args, { stdin: payload });
      assert.equal(actual.exitCode, 0, actual.stderr.toString());
      const virtual = host.requests.at(-1)!.body;
      await new Promise<void>((resolve, reject) => {
        const child = spawn("/usr/bin/curl", ["-q", "--noproxy", "*", ...args], { stdio: ["pipe", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", chunk => { stderr += chunk.toString(); });
        child.on("error", reject);
        child.on("close", code => { if (code === 0) resolve(); else reject(new Error(`native curl ${code}: ${stderr}`)); });
        child.stdin.end(payload);
      });
      const native = host.requests.at(-1)!.body;
      // Random MIME boundaries differ; compare the actual part headers and bytes.
      const part = (body: Buffer) => body.subarray(body.indexOf("\r\n") + 2, body.lastIndexOf("\r\n--"));
      assert.deepEqual(part(virtual), part(native));
    }
  } finally { await host.close(); }
});
