import assert from "node:assert/strict";
import { test } from "node:test";
import type { HttpRequest, NetworkAuthorization } from "../../../src/commands/network/index.js";
import { bounded, deferred, drain, response, start } from "./helpers.js";

const canonicalCases = [
  { name: "userinfo cannot disguise abbreviated loopback", input: "http://allowed.invalid@127.1/path", expected: "http://127.0.0.1/path" },
  { name: "decimal IPv4 is canonical before policy", input: "http://2130706433/", expected: "http://127.0.0.1/" },
  { name: "hexadecimal IPv4 is canonical before policy", input: "http://0x7f000001/", expected: "http://127.0.0.1/" },
  { name: "percent-encoded hostname is canonical before policy", input: "http://%31%32%37.0.0.1/", expected: "http://127.0.0.1/" },
  { name: "backslash authority boundary agrees between policy and transport", input: "http://allowed.invalid\\@127.0.0.1/", expected: "http://allowed.invalid/@127.0.0.1/" },
  { name: "IPv6 brackets reach policy without path glob rejection", input: "http://[::1]:80/", expected: "http://[::1]/" },
  { name: "scheme case default port and fragment normalize before policy", input: "HTTP://ALLOWED.INVALID:80/path#private", expected: "http://allowed.invalid/path" },
] as const;

for (const fixture of canonicalCases) {
  test(fixture.name, { timeout: 5000 }, async () => {
    const policies: NetworkAuthorization[] = [];
    const requests: HttpRequest[] = [];
    const execution = start([fixture.input], {
      authorize(request) { policies.push(request); return true; },
      transport: async request => { requests.push(request); return response(); },
    });
    try {
      assert.equal((await bounded(execution.done, fixture.name)).exitCode, 0);
      assert.equal(policies.length, 1);
      assert.equal(requests.length, 1);
      assert.equal(policies[0]!.url, fixture.expected);
      assert.equal(requests[0]!.url, fixture.expected);
      assert.equal(requests[0]!.signal, policies[0]!.signal);
    } finally { execution.controller.abort(); await execution.done.catch(() => {}); }
  });
}

for (const fixture of [
  { name: "non-HTTP protocol rejected before policy", input: "file:///etc/passwd", code: 1 },
  { name: "malformed percent-encoded userinfo rejected before policy", input: "http://user:%zz@allowed.invalid/", code: 3 },
  { name: "out-of-range port rejected before policy", input: "http://allowed.invalid:99999/", code: 3 },
  { name: "embedded URL control byte rejected before policy", input: "http://allowed.invalid/\nsecret", code: 3 },
]) {
  test(fixture.name, { timeout: 5000 }, async () => {
    let authorizations = 0;
    let transports = 0;
    const execution = start([fixture.input], {
      authorize() { authorizations++; return true; },
      transport: async () => { transports++; return response(); },
    });
    try {
      assert.equal((await bounded(execution.done, fixture.name)).exitCode, fixture.code);
      assert.equal(authorizations, 0);
      assert.equal(transports, 0);
    } finally { execution.controller.abort(); await execution.done.catch(() => {}); }
  });
}

test("normalized loopback redirect remains blocked during asynchronous policy", { timeout: 5000 }, async () => {
  const policies: NetworkAuthorization[] = [];
  const requests: HttpRequest[] = [];
  const entered = deferred<NetworkAuthorization>();
  const decision = deferred<boolean>();
  let disposals = 0;
  const execution = start(["-L", "http://allowed.invalid/start"], {
    authorize(request) {
      policies.push(request);
      if (policies.length === 1) return true;
      entered.resolve(request);
      return decision.promise;
    },
    transport: async request => {
      requests.push(request);
      return { ...response([["Location", "http://2130706433/private"]], 302), async dispose() { disposals++; } };
    },
  });
  try {
    const redirected = await bounded(entered.promise, "redirect policy entered");
    assert.equal(redirected.url, "http://127.0.0.1/private");
    assert.equal(redirected.redirectFrom, "http://allowed.invalid/start");
    assert.equal(redirected.attempt, 0);
    await drain();
    assert.equal(requests.length, 1, "pending redirect approval cannot authorize transport speculatively");
    assert.equal(disposals, 1);
    decision.resolve(false);
    assert.equal((await bounded(execution.done, "redirect denial")).exitCode, 7);
    assert.equal(policies.length, 2);
    assert.equal(requests.length, 1);
  } finally { decision.resolve(false); execution.controller.abort(); await execution.done.catch(() => {}); }
});

test("credential-bearing redirect is rejected before another policy or transport", { timeout: 5000 }, async () => {
  let policies = 0;
  let transports = 0;
  const execution = start(["-L", "http://allowed.invalid/start"], {
    authorize() { policies++; return true; },
    transport: async () => { transports++; return response([["Location", "http://user:secret@allowed.invalid/next"]], 302); },
  });
  try {
    const result = await bounded(execution.done, "redirect userinfo rejection");
    assert.equal(result.exitCode, 3);
    assert.doesNotMatch(result.stderr, /user:secret/);
    assert.equal(policies, 1);
    assert.equal(transports, 1);
  } finally { execution.controller.abort(); await execution.done.catch(() => {}); }
});
