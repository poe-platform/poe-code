import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { Shell } from "../../../src/shell/index.js";
import { networkCommands } from "../../../src/commands/network/index.js";
import { fixture, run, server } from "./helpers.js";

const payload = Buffer.from([82, 101, 252, 0, 10]);

for (const flag of ["-F", "--form"]) {
  for (const paths of [["first", "second"], ["second", "first"], ["comma,input", "second"]]) {
    test(`curl ${flag} sends ordered mixed file children ${paths}`, async () => {
      const host = await server();
      const fs = await fixture();
      const second = Buffer.from([255, 0, 248, 10]);
      await fs.writeFile("/work/first", payload);
      await fs.writeFile("/work/comma,input", payload);
      await fs.writeFile("/work/second", second);
      const shell = new Shell({ fs, cwd: "/work" }).use(networkCommands({ authorize: request => new URL(request.url).origin === host.origin }));
      try {
        const operand = paths.map(path => `"${path}"`).join(",");
        const result = await shell.exec(`curl -s ${flag === "-F" ? "-F" : "--form "}'field=@${operand}' '${host.origin}/echo'`);
        assert.equal(result.exitCode, 0, result.stderr);
        const body = host.requests[0]!.body;
        const headers = body.subarray(0, body.indexOf("\r\n\r\n")).toString();
        assert.ok(headers.includes('name="field"'));
        assert.ok(headers.includes("Content-Type: multipart/mixed; boundary="));
        assert.ok(!headers.includes("filename="));
        const boundary = headers.slice(headers.indexOf("boundary=") + 9).trim().replaceAll('"', "");
        const children = body.subarray(body.indexOf("\r\n\r\n") + 4).toString("latin1").split(`--${boundary}\r\n`).slice(1);
        assert.equal(children.length, 2);
        for (let index = 0; index < paths.length; index++) {
          const child = children[index]!;
          assert.ok(child.startsWith(`Content-Disposition: attachment; filename="${paths[index]}"\r\n`), child);
          assert.ok(!child.slice(0, child.indexOf("\r\n\r\n")).includes("name=\"field\""));
          assert.ok(child.includes((paths[index] === "second" ? second : payload).toString("latin1")));
        }
        assert.ok(body.includes(`--${boundary}--\r\n`));
      } finally { await shell.dispose(); await host.close(); }
    });
  }
}

test("multiple-file forms retain upload bounds and read failures", async () => {
  const host = await server();
  const fs = await fixture();
  await fs.writeFile("/work/first", payload);
  await fs.writeFile("/work/second", Buffer.alloc(2048));
  try {
    const bounded = await run(["-F", "field=@first,second", host.origin + "/echo"], { fs, options: { limits: { maxUploadBytes: 1024 } } });
    assert.equal(bounded.exitCode, 63);
    const missing = await run(["-F", "field=@first,missing", host.origin + "/echo"], { fs });
    assert.equal(missing.exitCode, 26);
  } finally { await host.close(); }
});

test("mixed file bodies agree with native curl including per-file attributes", async () => {
  const host = await server();
  const fs = await fixture();
  await fs.mkdir("/dev");
  await fs.writeFile("/dev/stdin", payload);
  await fs.writeFile("/dev/null", new Uint8Array());
  try {
    for (const operand of ["/dev/stdin,/dev/null", '/dev/null;filename="empty,first";type=text/plain,/dev/stdin;filename=last;type=application/octet-stream']) {
      const args = ["-sS", "-F", `field=@${operand}`, host.origin + "/echo"];
      const actual = await run(args, { fs });
      assert.equal(actual.exitCode, 0, actual.stderr.toString());
      const virtual = host.requests.at(-1)!.body;
      await new Promise<void>((resolve, reject) => {
        const child = spawn("/usr/bin/curl", ["-q", "--noproxy", "*", ...args], { stdio: ["pipe", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", chunk => { stderr += chunk.toString(); });
        child.on("error", reject);
        child.on("close", code => code === 0 ? resolve() : reject(new Error(`native curl ${code}: ${stderr}`)));
        child.stdin.end(payload);
      });
      const normalize = (body: Buffer) => {
        const outer = body.subarray(2, body.indexOf("\r\n")).toString();
        const headers = body.subarray(0, body.indexOf("\r\n\r\n")).toString();
        const inner = headers.slice(headers.indexOf("boundary=") + 9).trim().replaceAll('"', "");
        return body.toString("latin1").replaceAll(outer, "OUTER").replaceAll(`"${inner}"`, "INNER").replaceAll(inner, "INNER");
      };
      assert.equal(normalize(virtual), normalize(host.requests.at(-1)!.body));
    }
  } finally { await host.close(); }
});

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
