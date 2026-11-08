import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/encryption-reports.json", import.meta.url), "utf8")) as {
  cases: { name: string; pdf: string; reports: Record<string, string> }[];
};
const checks = JSON.parse(readFileSync(new URL("./fixtures/encryption-check-reports.json", import.meta.url), "utf8")) as {
  cases: Record<string, Record<string, string>>;
};
for (const mode of ["--show-encryption", "--check"]) for (const fixture of fixtures.cases) for (const [password, expected] of mode === "--check" ? Object.entries(checks.cases[fixture.name]!) : [
  ...Object.entries(fixture.reports),
  ...(fixture.reports.reader ? [undefined, "wrong"] : []).map(password => [password, "Incorrect password supplied\n" + fixture.reports.reader!.split("\n").filter(line => !line.startsWith("Supplied password")).map(line => line.startsWith("User password =") ? "User password = " : line).join("\n")] as const),
]) {
  it(`matches native qpdf encryption report for ${mode} ${fixture.name} with ${password} password on both paths`, async () => {
    const input = new Uint8Array(Buffer.from(fixture.pdf, "base64"));
    const args = [...(password === undefined ? [] : [`--password=${password}`]), mode, "/in.pdf"];
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      const result = await run(args, new Map([["/in.pdf", input]]));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
    }
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    const carrier = createCommandArguments(args), output: Uint8Array[] = [], errors: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { output.push(bytes); } }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } } });
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(output).toString(), expected);
    assert.equal(Buffer.concat(errors).toString(), "");
    assert.deepEqual(await fs.readFile("/in.pdf"), input);
    assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}

for (const operation of ["--check", "--decrypt"]) for (const password of [undefined, "wrong"]) {
  it(`matches native ${operation} rejection with ${password} password`, async () => {
    const fixture = fixtures.cases.find(item => item.name === "r6")!;
    const input = new Uint8Array(Buffer.from(fixture.pdf, "base64"));
    const options = [...(password === undefined ? [] : [`--password=${password}`]), operation];
    // Compared with native qpdf using the same r6 fixture and options.
    const expectedError = "qpdf: /in.pdf: invalid password\n";
    const args = [...options, "/in.pdf", ...(operation === "--decrypt" ? ["/out.pdf"] : [])];
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      const result = await run(args, new Map([["/in.pdf", input]]));
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, expectedError);
    }
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
    const carrier = createCommandArguments(args), output: Uint8Array[] = [], errors: Uint8Array[] = [];
    const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { output.push(bytes); } }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } } });
    assert.equal(result.exitCode, 2);
    assert.equal(Buffer.concat(output).toString(), "");
    assert.equal(Buffer.concat(errors).toString(), expectedError);
    await assert.rejects(fs.stat("/out.pdf"), { code: "ENOENT" });
    assert.deepEqual(await fs.readFile("/in.pdf"), input);
    assert.deepEqual(await fs.readdir("/scratch"), []);
  });
}

for (const name of ["issue19484_1", "issue19484_2"]) for (const password of [undefined, "", "wrong"]) {
  it(`rejects unauthenticated ${name} with ${JSON.stringify(password)} password on both paths`, async () => {
    const input = new Uint8Array(readFileSync(new URL(`../../pdf-ast/src/fixtures/pdfjs-${name}.pdf`, import.meta.url)));
    const options = password === undefined ? [] : [`--password=${password}`];
    for (const run of [runQpdfCli, runQpdfCliSync]) {
      for (const args of [["in.pdf", "out.pdf"], ["in.pdf", "-"], ["--check", "in.pdf"]]) {
        const files = new Map([["in.pdf", input]]);
        const result = await run([...options, ...args], files);
        assert.equal(result.exitCode, 2);
        assert.equal(result.stderr, "qpdf: in.pdf: invalid password\n");
        assert.equal(result.stdout, "");
        assert.deepEqual([...files.keys()], ["in.pdf"]);
        assert.deepEqual(files.get("in.pdf"), input);
      }
      const report = await run([...options, "--show-encryption", "in.pdf"], new Map([["in.pdf", input]]));
      assert.equal(report.exitCode, 0);
      assert.ok(report.stdout.startsWith("Incorrect password supplied\n"));
      assert.ok(!report.stdout.includes("Supplied password is"));
      for (const predicate of ["--is-encrypted", "--requires-password"]) {
        const result = await run([...options, predicate, "in.pdf"], new Map([["in.pdf", input]]));
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
      }
    }
    for (const operation of [[], ["--check"], ["--decrypt"]]) {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
      const args = [...options, ...operation, "/in.pdf", ...(operation.includes("--check") ? [] : ["/out.pdf"])];
      const carrier = createCommandArguments(args), output: Uint8Array[] = [], errors: Uint8Array[] = [];
      const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { output.push(bytes); } }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } } });
      assert.equal(result.exitCode, 2);
      assert.equal(Buffer.concat(output).toString(), "");
      assert.equal(Buffer.concat(errors).toString(), "qpdf: /in.pdf: invalid password\n");
      await assert.rejects(fs.stat("/out.pdf"), { code: "ENOENT" });
      assert.deepEqual(await fs.readFile("/in.pdf"), input);
      assert.deepEqual(await fs.readdir("/scratch"), []);
    }
  });
}

it("matches the native qpdf encryption report for an unsigned permission mask", async () => {
  const input = readFileSync(new URL("../../pdf-ast/src/fixtures/pypdf-r5-saslprep.pdf", import.meta.url));
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/in.pdf", input);
  const carrier = createCommandArguments(["--show-encryption", "/in.pdf"]);
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  const result = await createQpdfCommand().execute({
    command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/",
    env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes.slice()); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes.slice()); } },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(errors).toString(), "");
  // Complete report from native qpdf for the checked-in fixture.
  assert.equal(Buffer.concat(output).toString(), [
    "Incorrect password supplied",
    "R = 5",
    "P = -4",
    "User password = ",
    "extract for accessibility: allowed",
    "extract for any purpose: allowed",
    "print low resolution: allowed",
    "print high resolution: allowed",
    "modify document assembly: allowed",
    "modify forms: allowed",
    "modify annotations: allowed",
    "modify other: allowed",
    "modify anything: allowed",
    "stream encryption method: AESv3",
    "string encryption method: AESv3",
    "file encryption method: AESv3",
    "",
  ].join("\n"));
});
