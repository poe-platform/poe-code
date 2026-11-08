import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import * as own from "../dist/index.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const reference = await tsImport(
  "../../mcp-oauth/src/client/loopback-authorization.ts",
  import.meta.url
);
class Server extends EventEmitter {
  listen(port, host, callback) {
    this.listenArgs = [port, host];
    queueMicrotask(callback);
    return this;
  }
  address() {
    return { port: 12345 };
  }
  closeAllConnections() {
    this.connectionsClosed = true;
  }
  close() {
    this.closed = true;
  }
  request(url) {
    let status, headers, body;
    this.emit(
      "request",
      { url },
      {
        writeHead(code, values) {
          status = code;
          headers = values;
        },
        end(value) {
          body = value;
        }
      }
    );
    return { status, headers, body };
  }
}
const state = (issuer, requireIssuer) =>
  Buffer.from(JSON.stringify({ v: 1, n: "nonce", i: issuer, r: requireIssuer })).toString(
    "base64url"
  );
test("HTML rendering and manual extraction match UTF-16 escaping and URL parsing", () => {
  for (const page of [
    undefined,
    {},
    { title: "<&\"'>\ud800", body: "&<🦊\udfff" },
    { title: "", body: "" }
  ])
    assert.equal(own.buildSuccessPage(page), reference.buildSuccessPage(page));
  for (const input of [
    "",
    " \r\n",
    " code\ud800 \r\n",
    "\ufefft\ufeff",
    "\u0085",
    "https://localhost/?code=a+b&code=second",
    "https://localhost/?code=",
    "https://localhost/?error=denied",
    "urn:example:code",
    "\nhttps://localhost/?code=%EF%BF%BD\r"
  ])
    assert.equal(own.extractCodeFromInput(input), reference.extractCodeFromInput(input));
});
test("HTTP callback codes, denials and state/issuer binding match the oracle", async () => {
  const bound = state("https://issuer.example", true);
  for (const expected of [null, "expected", bound])
    for (const query of [
      "code=ok",
      "code=",
      "error=access_denied&error_description=Denied",
      "code=ok&state=wrong",
      `code=ok&state=${bound}`,
      `code=ok&state=${bound}&iss=https%3A%2F%2Fissuer.example`,
      `code=ok&state=${bound}&iss=wrong`,
      `error=denied&state=${bound}&iss=https%3A%2F%2Fissuer.example`
    ]) {
      let baseline;
      for (const factory of [reference, own]) {
        const server = new Server();
        const session = await factory.createLoopbackAuthorizationSession({
          createServer: () => server,
          callbackPath: "/oauth/callback",
          landingPage: { title: "Connected <", body: "Return &" }
        });
        assert.deepEqual(server.listenArgs, [0, "127.0.0.1"]);
        assert.equal(session.redirectUri, "http://127.0.0.1:12345/oauth/callback");
        const observed = session
          .waitForCode(
            "https://auth.example/authorize" +
              (expected === null ? "" : "?state=" + encodeURIComponent(expected))
          )
          .then(
            (code) => ({ code }),
            (error) => ({ error: error.message })
          );
        assert.equal(server.request("/other?code=ignore").status, 404);
        const response = server.request("/oauth/callback?" + query);
        const outcome = { response, result: await observed };
        if (factory === reference) baseline = outcome;
        else assert.deepEqual(outcome, baseline);
        session.close();
        assert.equal(server.closed, true);
        assert.equal(server.connectionsClosed, true);
      }
    }
});
test("manual input, browser failure and startup failure match the public contract", async () => {
  for (const manual of [
    "code-123",
    "",
    "http://127.0.0.1/callback?error=denied&error_description=No",
    "http://127.0.0.1/callback?code=ok&state=wrong"
  ]) {
    let baseline;
    for (const factory of [reference, own]) {
      const server = new Server();
      let opened;
      const session = await factory.createLoopbackAuthorizationSession({
        createServer: () => server,
        readLine: async () => manual,
        openBrowser: async (url) => {
          opened = url;
        }
      });
      const url = "https://auth.example/authorize";
      const result = await session.waitForCode(url).then(
        (code) => ({ code }),
        (error) => ({ error: error.message })
      );
      assert.equal(opened, url);
      if (factory === reference) baseline = result;
      else assert.deepEqual(result, baseline);
      session.close();
    }
  }
  for (const factory of [reference, own]) {
    const server = new Server();
    const reason = new Error("browser failed");
    const session = await factory.createLoopbackAuthorizationSession({
      createServer: () => server,
      openBrowser: async () => {
        throw reason;
      }
    });
    await assert.rejects(session.waitForCode("https://auth.example"), (error) => error === reason);
    session.close();
    const failing = new Server();
    failing.listen = function () {
      queueMicrotask(() => this.emit("error", new Error("address in use")));
    };
    await assert.rejects(
      factory.createLoopbackAuthorizationSession({ createServer: () => failing }),
      /address in use/
    );
    assert.equal(failing.listenerCount("error"), 0);
  }
});
test("browser rejection preserves non-Error reasons including undefined", async () => {
  for (const reason of [undefined, null, "browser rejected", 123]) {
    const server = new Server();
    const session = await own.createLoopbackAuthorizationSession({
      createServer: () => server,
      openBrowser: async () => {
        throw reason;
      }
    });
    const result = await session.waitForCode("https://auth.example").then(
      (value) => ({ value }),
      (error) => ({ error })
    );
    assert.deepEqual(result, { error: reason });
    session.close();
  }
});
test("session close disposes owned listeners and rejects pending waits once", async () => {
  const server = new Server();
  const unrelated = () => {};
  server.on("request", unrelated);
  const session = await own.createLoopbackAuthorizationSession({ createServer: () => server });
  const observed = session.waitForCode("https://auth.example").catch((error) => error.message);
  session.close();
  session.close();
  assert.equal(await observed, "OAuth authorization session closed");
  assert.equal(server.listenerCount("request"), 1);
  assert.equal(server.listeners("request")[0], unrelated);
  await assert.rejects(session.waitForCode("https://auth.example"), /session closed/);
});
test("repeated close/settlement cycles release owned callback listeners", async () => {
  for (let index = 0; index < 512; index++) {
    const server = new Server();
    const session = await own.createLoopbackAuthorizationSession({
      createServer: () => server,
      readLine: async () => "code"
    });
    const observed = session.waitForCode("https://auth.example").then(
      (code) => code,
      (error) => error.message
    );
    if (index % 2) assert.equal(await observed, "code");
    session.close();
    assert.equal(await observed, index % 2 ? "code" : "OAuth authorization session closed");
    assert.equal(server.listenerCount("request"), 0);
    assert.equal(server.listenerCount("error"), 0);
  }
});

test("authorization denials retain branded diagnostics across bundled copies", () => {
  for (const factory of [own, reference]) {
    const failure = new factory.OAuthAuthorizationError("access_denied", "Denied");
    assert.equal(failure.error, "access_denied");
    assert.equal(failure.errorDescription, "Denied");
    assert.equal(own.OAuthAuthorizationError.is(failure), true);
    assert.equal(reference.OAuthAuthorizationError.is(failure), true);
  }
  const brand = Symbol.for("poe-platform.mcp-oauth.OAuthAuthorizationError"),
    seen = [];
  const candidate = new Error("unbranded");
  Object.defineProperty(candidate, brand, {
    get() {
      seen.push("get");
      return true;
    }
  });
  assert.equal(own.OAuthAuthorizationError.is(candidate), false);
  assert.deepEqual(seen, []);
  assert.equal(own.OAuthAuthorizationError.is({ [brand]: true }), false);
});
test("callback ambiguity rejects duplicate recognized fields before state binding", async () => {
  for (const parameter of ["code", "state", "iss", "error", "error_description", "error_uri"]) {
    const url = `http://127.0.0.1/callback?code=ok&${parameter}=a&${parameter}=b`;
    assert.equal(own.extractCodeFromInput(url), reference.extractCodeFromInput(url));
    for (const factory of [reference, own]) {
      const server = new Server(),
        session = await factory.createLoopbackAuthorizationSession({ createServer: () => server });
      try {
        const result = session.waitForCode("https://auth.example/?state=expected").then(
          () => null,
          (error) => error
        );
        const response = server.request("/callback?" + new URL(url).searchParams.toString()),
          failure = await result;
        assert.ok(failure.message.includes("must occur only once"));
        assert.equal(response.status, 400);
        assert.deepEqual(response.headers, {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff"
        });
      } finally {
        session.close();
      }
    }
  }
  for (const redirectUri of [
    "http://127.0.0.1/callback#",
    "http://127.0.0.1/callback?error_uri=fixed"
  ])
    for (const factory of [reference, own])
      await assert.rejects(factory.createLoopbackAuthorizationSession({ redirectUri }), (error) =>
        error.message.includes("Invalid OAuth loopback redirect URI")
      );
});

test("private landing-page receivers are captured before browser mutation", async () => {
  class Page {
    #title = "Original <title>";
    #body = "Original & body";
    get title() {
      return this.#title;
    }
    get body() {
      return this.#body;
    }
    mutate() {
      this.#title = "Replacement";
      this.#body = "Replacement";
    }
  }
  for (const api of [reference, own]) {
    const page = new Page(),
      server = new Server(),
      session = await api.createLoopbackAuthorizationSession({
        landingPage: page,
        createServer: () => server,
        openBrowser: async () => page.mutate()
      });
    try {
      const waiting = session.waitForCode("https://auth.example/authorize?state=expected");
      const response = server.request("/callback?state=expected&code=005930");
      assert.equal(await waiting, "005930");
      assert.ok(response.body.includes("Original &lt;title&gt;"));
      assert.ok(response.body.includes("Original &amp; body"));
      assert.equal(response.body.includes("Replacement"), false);
    } finally {
      session.close();
    }
  }
});
