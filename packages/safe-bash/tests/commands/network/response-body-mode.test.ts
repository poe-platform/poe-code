import assert from "node:assert/strict";
import test from "node:test";
import { Shell, MemoryFileSystem, toByteSource } from "../../../src/index.js";
import { networkCommands, type HttpRequest } from "../../../src/commands/network/index.js";

for (const profile of [
  { args: "", method: "GET", mode: "read" },
  { args: "-i", method: "GET", mode: "read" },
  { args: "-I", method: "HEAD", mode: "omit" },
  { args: "-I -X GET", method: "GET", mode: "omit" },
  { args: "-X HEAD", method: "HEAD", mode: "read" },
  { args: "-f", method: "GET", mode: "omit-on-http-error" },
  { args: "--fail-with-body", method: "GET", mode: "read" },
  { args: "-I -f", method: "HEAD", mode: "omit" },
] as const) {
  for (const path of ["direct", "redirect", "retry"] as const) {
    test(`curl ${profile.args || "GET"} preserves response body intent across ${path}`, async () => {
      const requests: HttpRequest[] = [];
      const disposed: number[] = [];
      let reads = 0;
      const shell = new Shell({ fs: new MemoryFileSystem() }).use(networkCommands({
        authorize: () => true,
        async transport(request) {
          requests.push(request);
          const index = requests.length - 1;
          const status = index === 0 && path !== "direct" ? path === "redirect" ? 302 : 503 : 200;
          return {
            status, statusText: "Fixture",
            headers: status === 302 ? [["Location", "/next"]] : [],
            body: (async function* () { reads++; yield* toByteSource("payload"); })(),
            async dispose() { disposed.push(index); },
          };
        },
      }));
      try {
        const flags = path === "redirect" ? "-L" : path === "retry" ? "--retry 1 --retry-delay 0.001" : "";
        const result = await shell.exec(`curl ${profile.args} ${flags} https://offline.invalid/start`);
        assert.equal(result.exitCode, 0, result.stderr.toString());
        assert.deepEqual(requests.map(({ method, responseBodyMode }) => ({ method, responseBodyMode })),
          Array.from({ length: path === "direct" ? 1 : 2 }, () => ({ method: profile.method, responseBodyMode: profile.mode })));
        assert.deepEqual(disposed, requests.map((_, index) => index));
        assert.equal(reads, profile.mode === "omit" ? 0 : path === "retry" && profile.mode === "read" ? 2 : 1);
        assert.equal(result.stdout.toString().includes("payload"), profile.mode !== "omit");
      } finally { await shell.dispose(); }
    });
  }
}

for (const profile of [
  { flags: "-f", method: "GET", mode: "omit-on-http-error", reads: 0, output: true },
  { flags: "--fail-with-body", method: "GET", mode: "read", reads: 1, output: true },
  { flags: "-I -f", method: "HEAD", mode: "omit", reads: 0, output: false },
  { flags: "-I -X GET -f", method: "GET", mode: "omit", reads: 0, output: false },
  { flags: "-I --fail-with-body", method: "HEAD", mode: "omit", reads: 0, output: false },
] as const) {
  for (const status of [399, 400, 404, 500]) test(`curl ${profile.flags} handles HTTP ${status} with the requested body intent`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", Buffer.from("existing"));
    let writes = 0;
    let reads = 0;
    const writeFile = fs.writeFile.bind(fs);
    const writeStream = fs.writeStream.bind(fs);
    fs.writeFile = async (...args) => { writes++; await writeFile(...args); };
    fs.writeStream = async (...args) => { writes++; await writeStream(...args); };
    const requests: HttpRequest[] = [];
    const shell = new Shell({ fs }).use(networkCommands({
      authorize: () => true,
      async transport(request) {
        requests.push(request);
        return {
          status, statusText: "Fixture", headers: [],
          body: (async function* () { reads++; yield* toByteSource("payload"); })(),
          async dispose() {},
        };
      },
    }));
    try {
      const result = await shell.exec(`curl ${profile.flags} ${profile.output ? "-o /out" : ""} https://offline.invalid/missing`);
      const expectedReads = status < 400 && profile.mode === "omit-on-http-error" ? 1 : profile.reads;
      assert.equal(result.exitCode, status >= 400 ? 22 : 0, result.stderr.toString());
      assert.deepEqual(requests.map(({ method, responseBodyMode }) => ({ method, responseBodyMode })),
        [{ method: profile.method, responseBodyMode: profile.mode }]);
      assert.equal(reads, expectedReads);
      assert.equal(writes > 0, profile.output && expectedReads > 0);
      assert.equal(Buffer.from(await fs.readFile("/out")).toString(), profile.output && expectedReads > 0 ? "payload" : "existing");
    } finally { await shell.dispose(); }
  });
}

for (const flags of ["-f --fail-with-body", "--fail-with-body -f", "-I -f --fail-with-body", "-I --fail-with-body -f"]) {
  test(`curl rejects mutually exclusive ${flags} before authorization or file access`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", Buffer.from("existing"));
    let authorizations = 0;
    let requests = 0;
    let writes = 0;
    const writeFile = fs.writeFile.bind(fs);
    const writeStream = fs.writeStream.bind(fs);
    fs.writeFile = async (...args) => { writes++; await writeFile(...args); };
    fs.writeStream = async (...args) => { writes++; await writeStream(...args); };
    const shell = new Shell({ fs }).use(networkCommands({
      authorize: () => { authorizations++; return true; },
      async transport() { requests++; throw new Error("unexpected transport"); },
    }));
    try {
      const result = await shell.exec(`curl ${flags} -o /out https://offline.invalid/missing`);
      assert.equal(result.exitCode, 2);
      assert.ok(result.stderr.toString().includes("mutually exclusive"));
      assert.deepEqual({ authorizations, requests, writes }, { authorizations: 0, requests: 0, writes: 0 });
      assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "existing");
    } finally { await shell.dispose(); }
  });
}
