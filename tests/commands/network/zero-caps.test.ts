import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Shell, MemoryFileSystem, createCurlCommand as rootCreateCurlCommand, toByteSource,
  type ByteSource, type CommandContext,
} from "../../../src/index.js";
import {
  createCurlCommand, defaultNetworkLimits, networkCommands,
  type HttpHeaders, type NetworkCommandsOptions, type NetworkLimits,
} from "../../../src/commands/network/index.js";

type Mode = "direct" | "shell";
interface Reply {
  status?: number;
  headers?: HttpHeaders;
  error?: string;
}
const origin = "https://offline.invalid";
const url = `${origin}/start`;
const payload = Buffer.alloc(1024, 97);
const writeout = "%{http_code}|%{num_redirects}|%{num_retries}|%{size_upload}|%{size_download}|%{exitcode}|%{url_effective}|%{redirect_url}\\n";
const zero = { maxRedirects: 0, maxRetries: 0 };

async function fixture(mode: Mode, limits: Partial<NetworkLimits>, replies: readonly Reply[], settings: {
  upload?: "stdin" | "file";
  denyAt?: number;
  abortAt?: number;
  consumeUpload?: boolean;
} = {}) {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/upload", payload);
  await fs.writeFile("/work/out", Buffer.from("existing"));
  const state = {
    authorizations: [] as { url: string; method: string; attempt: number; redirectFrom?: string }[],
    requests: [] as { url: string; method: string; headers: HttpHeaders }[],
    uploads: [] as Buffer[], stdinOpens: 0, stdinReads: 0, stdinCloses: 0,
    fileOpens: 0, fileReads: 0, fileBytes: 0, responseReads: 0, disposed: [] as number[],
  };
  const originalReadStream = fs.readStream.bind(fs);
  fs.readStream = function (path, options): ByteSource {
    if (path !== "/work/upload") return originalReadStream(path, options);
    state.fileOpens++;
    return (async function* () {
      for await (const chunk of originalReadStream(path, options)) {
        state.fileReads++; state.fileBytes += chunk.length; yield chunk;
      }
    })();
  };
  const stdin: ByteSource = {
    [Symbol.asyncIterator]() {
      state.stdinOpens++;
      return (async function* () {
        try { state.stdinReads++; yield payload; }
        finally { state.stdinCloses++; }
      })();
    },
  };
  const controller = new AbortController();
  const reason = new Error("zero-cap caller cancellation");
  const options: NetworkCommandsOptions = {
    limits: { maxBufferBytes: 512, maxUploadBytes: payload.length, ...limits },
    authorize(request) {
      const { url, method, attempt, redirectFrom } = request;
      state.authorizations.push({ url, method, attempt, ...(redirectFrom === undefined ? {} : { redirectFrom }) });
      if (state.authorizations.length === settings.abortAt) controller.abort(reason);
      return state.authorizations.length !== settings.denyAt;
    },
    async transport(request) {
      state.requests.push({ url: request.url, method: request.method, headers: request.headers });
      const index = state.requests.length - 1;
      const reply = replies[index];
      assert.ok(reply, "unexpected additional transport request");
      const chunks: Buffer[] = [];
      if (settings.consumeUpload !== false && request.body) {
        for await (const chunk of request.body) chunks.push(Buffer.from(chunk));
      }
      state.uploads.push(Buffer.concat(chunks));
      if (reply.error) throw Object.assign(new Error("private transport details"), { code: reply.error });
      state.disposed[index] = 0;
      return {
        status: reply.status ?? 200, statusText: "Fixture", headers: reply.headers ?? [],
        body: (async function* () { state.responseReads++; yield Buffer.from("reply"); })(),
        async dispose() { state.disposed[index] = (state.disposed[index] ?? 0) + 1; },
      };
    },
  };
  const command = mode === "direct" ? createCurlCommand(options) : undefined;
  const shell = mode === "shell" ? new Shell({ fs, cwd: "/work" }).use(networkCommands(options)) : undefined;
  return {
    fs, state, controller, reason, options,
    async run(args: readonly string[]) {
      const input = settings.upload === "stdin" ? stdin : toByteSource("");
      const upload = settings.upload ? ["-T", settings.upload === "stdin" ? "-" : "upload"] : [];
      const argv = [...upload, ...args];
      try {
        if (shell) return await shell.exec(["curl", ...argv].map(value => `'${value.replaceAll("'", "'\\''")}'`).join(" "), {
          stdin: input, signal: controller.signal,
        });
        const stdout: Buffer[] = []; const stderr: Buffer[] = [];
        const context: CommandContext = {
          command: "curl", args: argv, cwd: "/work", env: {}, fs, stdin: input, signal: controller.signal,
          stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
          stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
        };
        const result = await command!.execute(context);
        return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
      } finally { await shell?.dispose(); }
    },
  };
}

function assertRequests(state: Awaited<ReturnType<typeof fixture>>["state"], attempts: number[], urls = attempts.map(() => url)) {
  assert.equal(state.requests.length, attempts.length);
  assert.deepEqual(state.requests.map(request => request.url), urls);
  assert.deepEqual(state.authorizations.map(request => request.attempt), attempts);
  assert.deepEqual(state.authorizations.map(request => request.url), urls);
  assert.deepEqual(state.disposed, attempts.map(() => 1));
}

function construct(limits: Partial<NetworkLimits>): void {
  const options = { authorize: () => true, transport: async () => { throw new Error("construction must not send"); }, limits };
  assert.equal(createCurlCommand(options).name, "curl");
  assert.equal(rootCreateCurlCommand(options).name, "curl");
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(networkCommands(options));
  void shell.dispose();
}

test("count constructors accept zero, negative zero, one, defaults and exact safe maximum", () => {
  construct({});
  for (const value of [0, -0, 1, Number.MAX_SAFE_INTEGER]) {
    construct({ maxRedirects: value }); construct({ maxRetries: value });
    construct({ maxRedirects: value, maxRetries: value });
  }
  assert.equal(defaultNetworkLimits.maxRedirects, 10);
  assert.equal(defaultNetworkLimits.maxRetries, 5);
  assert.ok(Object.isFrozen(defaultNetworkLimits));
});

const invalid = [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "0", null, undefined, true, false];
for (const name of ["maxRedirects", "maxRetries"] as const) {
  for (const value of invalid) test(`${name} rejects ${String(value)} (${typeof value}) through direct and plugin APIs`, () => {
    const options = { authorize: () => true, limits: { [name]: value } as Partial<NetworkLimits> };
    const expected = { name: "RangeError", message: `Invalid network limit: ${name}` };
    assert.throws(() => createCurlCommand(options), expected);
    assert.throws(() => new Shell({ fs: new MemoryFileSystem() }).use(networkCommands(options)), expected);
  });
}

for (const name of ["maxUploadBytes", "maxDownloadBytes", "maxBufferBytes", "maxHeaderBytes", "maxUrls", "maxTimeMs"] as const) {
  test(`${name} retains positive safe boundaries`, () => {
    const maximum = name === "maxTimeMs" ? 2_147_483_647 : Number.MAX_SAFE_INTEGER;
    construct({ [name]: 1 }); construct({ [name]: maximum });
    for (const value of [0, -0, ...invalid, maximum + 1]) {
      assert.throws(() => construct({ [name]: value } as Partial<NetworkLimits>), {
        name: "RangeError", message: `Invalid network limit: ${name}`,
      });
    }
  });
}

test("only the two exact count keys gain a zero minimum", () => {
  assert.throws(() => construct({ maxRedirect: 0 } as Partial<NetworkLimits>), /Invalid network limit: maxRedirect/);
});

for (const mode of ["direct", "shell"] as const) {
  for (const status of [200, 301, 302, 303, 307, 308, 408, 429, 500, 502, 503, 504]) {
    for (const upload of ["stdin", "file"] as const) test(`${mode}: both zero, ${status}, ${upload}, CLI increases cannot add requests`, async () => {
      const redirect = status >= 300 && status < 400;
      const headers: HttpHeaders = redirect ? [["Location", "/next"]] : [["Retry-After", "3600"]];
      const setup = await fixture(mode, zero, [{ status, headers }], { upload });
      const result = await setup.run(["-L", "--max-redirs", "9007199254740991", "--retry", "9007199254740991", "-m", "0.2", "-D", "headers", "-o", "out", "-w", writeout, url]);
      const code = redirect ? 47 : 0;
      assert.equal(result.exitCode, code, result.stderr);
      assert.equal(result.stdout, `${status}|0|0|1024|${redirect ? 0 : 5}|${code}|${url}|${redirect ? `${origin}/next` : ""}\n`);
      assert.equal(result.stderr, redirect ? "curl: (47) Maximum redirects exceeded\n" : "");
      assertRequests(setup.state, [0]);
      assert.deepEqual(setup.state.uploads, [payload]);
      assert.equal(setup.state.stdinReads, upload === "stdin" ? 1 : 0);
      assert.equal(setup.state.stdinOpens, upload === "stdin" ? 1 : 0);
      assert.equal(setup.state.stdinCloses, upload === "stdin" ? 1 : 0);
      assert.equal(setup.state.fileOpens, upload === "file" ? 1 : 0);
      assert.equal(setup.state.fileReads, upload === "file" ? 1 : 0);
      assert.equal(setup.state.fileBytes, upload === "file" ? payload.length : 0);
      assert.equal(setup.state.responseReads, redirect ? 0 : 1);
      assert.equal(Buffer.from(await setup.fs.readFile("/work/out")).toString(), redirect ? "existing" : "reply");
      assert.equal(Buffer.from(await setup.fs.readFile("/work/headers")).toString(), `HTTP/1.1 ${status} Fixture\r\n${redirect ? "Location: /next" : "Retry-After: 3600"}\r\n\r\n`);
    });
  }

  for (const status of [307, 308]) for (const missingLocation of [false, true]) {
    test(`${mode}: zero ${status} ${missingLocation ? "missing Location with -L" : "without -L"} publishes initial response`, async () => {
      const setup = await fixture(mode, zero, [{ status, headers: missingLocation ? [] : [["Location", "/next"]] }]);
      const result = await setup.run([...(missingLocation ? ["-L"] : []), "-w", writeout, url]);
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
      assert.equal(result.stdout, `reply${status}|0|0|0|5|0|${url}|${missingLocation ? "" : `${origin}/next`}\n`);
      assertRequests(setup.state, [0]);
    });
  }

  for (const status of [429, 503]) for (const flag of ["--fail", "--fail-with-body"]) {
    test(`${mode}: zero retry ${status} preserves ${flag}, headers, file and writeout`, async () => {
      const setup = await fixture(mode, zero, [{ status, headers: [["Retry-After", "3600"]] }]);
      const result = await setup.run([flag, "--retry", "9", "-m", "0.2", "-D", "headers", "-o", "out", "-w", writeout, url]);
      const body = flag === "--fail-with-body";
      assert.equal(result.exitCode, 22);
      assert.equal(result.stdout, `${status}|0|0|0|${body ? 5 : 0}|22|${url}|\n`);
      assert.equal(result.stderr, `curl: (22) HTTP response status ${status}\n`);
      assert.equal(Buffer.from(await setup.fs.readFile("/work/out")).toString(), body ? "reply" : "existing");
      assert.equal(Buffer.from(await setup.fs.readFile("/work/headers")).toString(), `HTTP/1.1 ${status} Fixture\r\nRetry-After: 3600\r\n\r\n`);
      assert.equal(setup.state.responseReads, body ? 1 : 0); assertRequests(setup.state, [0]);
    });
  }

  for (const [error, code] of [["ENOTFOUND", 6], ["ECONNREFUSED", 7], ["ECONNRESET", 56]] as const) {
    test(`${mode}: transport ${error} remains ${code} without retries or leaked details`, async () => {
      const setup = await fixture(mode, zero, [{ error }]);
      const result = await setup.run(["--retry", "8", "-w", writeout, url]);
      assert.equal(result.exitCode, code);
      assert.equal(result.stdout, `000|0|0|0|0|${code}|${url}|\n`);
      assert.doesNotMatch(result.stderr, /private/);
      assert.equal(setup.state.requests.length, 1);
      assert.deepEqual(setup.state.authorizations.map(request => request.attempt), [0]);
      assert.deepEqual(setup.state.disposed, []);
    });
  }

  for (const upload of ["stdin", "file"] as const) for (const control of ["denied", "pre-aborted", "authorization-aborted"] as const) {
    test(`${mode}: ${control} ${upload} performs no transport or upload reads`, async () => {
      const setup = await fixture(mode, zero, [], {
        upload, ...(control === "denied" ? { denyAt: 1 } : control === "authorization-aborted" ? { abortAt: 1 } : {}),
      });
      if (control === "pre-aborted") setup.controller.abort(setup.reason);
      if (control === "denied") assert.equal((await setup.run(["-L", "--retry", "5", url])).exitCode, 7);
      else await assert.rejects(setup.run(["-L", "--retry", "5", url]), error => error === setup.reason);
      assert.equal(setup.state.authorizations.length, control === "pre-aborted" ? 0 : 1);
      assert.equal(setup.state.requests.length, 0); assert.deepEqual(setup.state.uploads, []);
      assert.equal(setup.state.stdinReads, 0);
      assert.equal(setup.state.stdinOpens, mode === "shell" && upload === "stdin" && control !== "pre-aborted" ? 1 : 0);
      assert.equal(setup.state.fileOpens, 0); assert.equal(setup.state.fileBytes, 0);
      assert.deepEqual(setup.state.disposed, []);
    });
  }

  test(`${mode}: transport need not consume an initial upload at zero`, async () => {
    const setup = await fixture(mode, zero, [{}], { upload: "stdin", consumeUpload: false });
    assert.equal((await setup.run([url])).exitCode, 0);
    assertRequests(setup.state, [0]); assert.equal(setup.state.stdinReads, 0);
    assert.equal(setup.state.stdinOpens, mode === "shell" ? 1 : 0);
  });

  test(`${mode}: zero prevents cached replay as well as fresh producer reads`, async () => {
    const setup = await fixture(mode, { ...zero, maxBufferBytes: 2048 }, [{ status: 503 }], { upload: "stdin" });
    assert.equal((await setup.run(["--retry", "9", url])).exitCode, 0);
    assertRequests(setup.state, [0]); assert.deepEqual(setup.state.uploads, [payload]);
    assert.equal(setup.state.stdinReads, 1); assert.equal(setup.state.stdinOpens, 1);
  });

  test(`${mode}: constructor snapshots overrides without mutating caller limits`, async () => {
    const setup = await fixture(mode, zero, [{ status: 307, headers: [["Location", "/next"]] }]);
    Object.assign(setup.options.limits!, { maxRedirects: 1, maxRetries: 1 });
    assert.equal((await setup.run(["-L", "--retry", "9", url])).exitCode, 47);
    assertRequests(setup.state, [0]);
    assert.deepEqual(setup.options.limits, { maxBufferBytes: 512, maxUploadBytes: 1024, maxRedirects: 1, maxRetries: 1 });
  });

  for (const kind of ["redirect", "retry"] as const) {
    test(`${mode}: ${kind} cap one refuses a third request despite CLI increases`, async () => {
      const redirect = kind === "redirect";
      const reply: Reply = redirect ? { status: 307, headers: [["Location", url]] } : { status: 429 };
      const setup = await fixture(mode, { maxRedirects: 1, maxRetries: 1 }, [reply, reply]);
      const result = await setup.run(["-L", "--max-redirs", "9", "--retry", "9", "--retry-delay", "0.001", url]);
      assert.equal(result.exitCode, redirect ? 47 : 0, result.stderr);
      assertRequests(setup.state, [0, redirect ? 0 : 1]);
    });
    test(`${mode}: independent ${kind} cap one permits exactly one followup`, async () => {
      const redirect = kind === "redirect";
      const limits = redirect ? { maxRedirects: 1, maxRetries: 0 } : { maxRedirects: 0, maxRetries: 1 };
      const setup = await fixture(mode, limits, [
        redirect ? { status: 308, headers: [["Location", "/next"]] } : { status: 503 }, {},
      ], { upload: "file" });
      const result = await setup.run(["-L", "--max-redirs", "9", "--retry", "9", "--retry-delay", "0.001", "-o", "out", url]);
      assert.equal(result.exitCode, 0, result.stderr);
      assertRequests(setup.state, [0, redirect ? 0 : 1], [url, redirect ? `${origin}/next` : url]);
      assert.deepEqual(setup.state.uploads, [payload, payload]); assert.equal(setup.state.fileOpens, 2);
      assert.equal(setup.state.fileBytes, payload.length * 2);
      assert.equal(Buffer.from(await setup.fs.readFile("/work/out")).toString(), "reply");
    });
  }

  test(`${mode}: redirect cap one authorizes next hop and strips cross-origin credentials`, async () => {
    const target = "https://other.invalid/next";
    for (const denyAt of [2, 3]) {
      const setup = await fixture(mode, { maxRedirects: 1, maxRetries: 0 }, [
        { status: 307, headers: [["Location", target]] }, {},
      ], { denyAt, upload: "file" });
      const result = await setup.run(["-L", "-H", "X-Secret: private", "-u", "user:password", url]);
      assert.equal(result.exitCode, denyAt === 2 ? 7 : 0);
      assert.deepEqual(setup.state.authorizations, [
        { url, method: "PUT", attempt: 0 }, { url: target, method: "PUT", attempt: 0, redirectFrom: url },
      ]);
      assert.equal(setup.state.requests.length, denyAt === 2 ? 1 : 2);
      assert.equal(setup.state.fileOpens, denyAt === 2 ? 1 : 2);
      assert.deepEqual(setup.state.disposed, denyAt === 2 ? [1] : [1, 1]);
      if (denyAt === 3) assert.ok(setup.state.requests[1]!.headers.every(([name]) => !["authorization", "x-secret"].includes(name.toLowerCase())));
    }
  });

  test(`${mode}: zero applies independently to every input URL`, async () => {
    const urls = [url, `${origin}/second`];
    const setup = await fixture(mode, zero, [{ status: 503 }, {}]);
    const result = await setup.run(["--retry", "9", "-L", ...urls]);
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, "replyreply");
    assertRequests(setup.state, [0, 0], urls);
  });

  test(`${mode}: redirect cap one restarts within each retry of each URL`, async () => {
    const setup = await fixture(mode, { maxRedirects: 1, maxRetries: 1 }, [
      { status: 307, headers: [["Location", "/next"]] }, { status: 503 },
      { status: 308, headers: [["Location", "/next"]] }, {},
    ]);
    assert.equal((await setup.run(["-L", "--retry", "9", "--retry-delay", "0.001", url])).exitCode, 0);
    assertRequests(setup.state, [0, 0, 1, 1], [url, `${origin}/next`, url, `${origin}/next`]);
  });

  test(`${mode}: negative zero executes as zero`, async () => {
    const setup = await fixture(mode, { maxRedirects: -0, maxRetries: -0 }, [{ status: 307, headers: [["Location", "/next"]] }]);
    assert.equal((await setup.run(["-L", "--retry", "9", url])).exitCode, 47);
    assertRequests(setup.state, [0]);
  });

  test(`${mode}: omitted host caps retain ten redirects and five retries`, async () => {
    const redirects = await fixture(mode, {}, Array.from({ length: 11 }, () => ({ status: 307, headers: [["Location", url]] as HttpHeaders })));
    assert.equal((await redirects.run(["-L", "--max-redirs", "99", url])).exitCode, 47);
    assertRequests(redirects.state, Array<number>(11).fill(0));
    const retries = await fixture(mode, {}, Array.from({ length: 6 }, () => ({ status: 503 })));
    assert.equal((await retries.run(["--retry", "99", "--retry-delay", "0.001", url])).exitCode, 0);
    assertRequests(retries.state, [0, 1, 2, 3, 4, 5]);
    const implicit = await fixture(mode, {}, [{ status: 503 }]);
    assert.equal((await implicit.run([url])).exitCode, 0); assertRequests(implicit.state, [0]);
  });

  test(`${mode}: zero host caps match CLI zero under positive host caps`, async () => {
    for (const reply of [
      { status: 307, headers: [["Location", "/next"]] as HttpHeaders },
      { status: 503, headers: [["Retry-After", "3600"]] as HttpHeaders }, { error: "ECONNRESET" },
    ]) {
      const actual = await fixture(mode, zero, [reply], { upload: "stdin" });
      const control = await fixture(mode, { maxRedirects: 1, maxRetries: 1 }, [reply], { upload: "stdin" });
      const args = ["-L", "--fail-with-body", "-D", "headers", "-o", "out", "-w", writeout, url];
      assert.deepEqual(await actual.run(["--retry", "9", "--max-redirs", "9", ...args]),
        await control.run(["--retry", "0", "--max-redirs", "0", ...args]));
      assert.deepEqual(actual.state, control.state);
      assert.deepEqual(await actual.fs.readFile("/work/out"), await control.fs.readFile("/work/out"));
      if (!reply.error) assert.deepEqual(await actual.fs.readFile("/work/headers"), await control.fs.readFile("/work/headers"));
    }
  });
}
