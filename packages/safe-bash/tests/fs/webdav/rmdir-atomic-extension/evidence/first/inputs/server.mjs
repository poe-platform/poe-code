import { createServer, request } from "node:http";
import { lstat, realpath, rmdir } from "node:fs/promises";
import { join } from "node:path";

export const operation = "atomic-empty-rmdir/v1";
export const syntheticAuthorization = "Bearer owned-loopback-fixture-only";

function fault(code, status) {
  return Object.assign(new Error(code), { code, status });
}

export function canonicalPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\\")
    || /[\u0000-\u001f\u007f]/u.test(value) || value.length > 1024) throw fault("EINVAL", 400);
  if (value !== "/" && value.slice(1).split("/").some((part) => !part || part === "." || part === "..")) {
    throw fault("EINVAL", 400);
  }
  return value;
}

export async function startFixture(configuredRoot) {
  const root = await realpath(configuredRoot);
  const rootStat = await lstat(root, { bigint: true });
  const records = [];
  const hooks = new Map();
  const policyLocks = new Map();
  const pending = new Set();
  let namespaceUrl;
  let endpoint;

  function authorizeLocks(path, token) {
    for (const [lockPath, lock] of policyLocks) {
      if (path !== lockPath && !path.startsWith(`${lockPath}/`)) continue;
      if (lock.expiresAt <= Date.now()) {
        if (token !== undefined) throw fault("EPRECONDITION", 412);
        continue;
      }
      if (lock.principal !== "fixture-writer" || token !== lock.token) throw fault("ELOCKED", 423);
    }
    if (token !== undefined && ![...policyLocks].some(([lockPath, lock]) =>
      (path === lockPath || path.startsWith(`${lockPath}/`)) && lock.token === token
      && lock.principal === "fixture-writer" && lock.expiresAt > Date.now())) {
      throw fault("EPRECONDITION", 412);
    }
  }

  async function handle(incoming, response) {
    const record = { method: incoming.method, url: incoming.url, nativeCalls: 0 };
    records.push(record);
    const controller = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    const finish = (status, body) => {
      record.status = status;
      record.result = body;
      if (response.destroyed) return;
      const bytes = Buffer.from(JSON.stringify(body));
      response.writeHead(status, { "content-type": "application/json", "content-length": bytes.length });
      response.end(bytes);
    };
    try {
      if (incoming.headers.host !== new URL(endpoint).host) throw fault("EBINDING", 409);
      if (incoming.url !== "/_test/atomic-rmdir") throw fault("ENOENT", 404);
      if (incoming.method !== "POST") throw fault("EMETHOD", 405);
      if (incoming.headers.authorization !== syntheticAuthorization) throw fault("EAUTH", 401);
      if (incoming.headers["content-type"] !== "application/json") throw fault("EINVAL", 400);
      const chunks = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 4096) throw fault("E2BIG", 413);
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw fault("EINVAL", 400); }
      if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).sort().join(",") !== "namespaceUrl,operation,path"
        || input.operation !== operation) throw fault("EINVAL", 400);
      if (input.namespaceUrl !== namespaceUrl) throw fault("EBINDING", 409);
      const path = canonicalPath(input.path);
      record.path = path;
      if (path === "/") throw fault("EBUSY", 409);
      if (!path.startsWith("/allowed/")) throw fault("EACCES", 403);
      if (incoming.headers["if-match"] !== undefined || incoming.headers.if !== undefined) {
        throw fault("ENOTSUP", 501);
      }
      const currentRoot = await lstat(root, { bigint: true });
      if (!currentRoot.isDirectory() || currentRoot.isSymbolicLink()
        || currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino) throw fault("EBINDING", 409);
      const parts = path.slice(1).split("/");
      let nativePath = root;
      for (const part of parts) {
        nativePath = join(nativePath, part);
        const stat = await lstat(nativePath);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw fault("ENOTDIR", 409);
      }
      const hook = hooks.get(path);
      await hook?.beforeNative?.(controller.signal);
      if (controller.signal.aborted) throw fault("ECANCELED", 499);
      authorizeLocks(path, incoming.headers["x-fixture-lock-token"]);
      record.nativeCalls++;
      await rmdir(nativePath);
      record.nativeOutcome = "removed";
      await hook?.afterNative?.(controller.signal);
      finish(200, { operation, namespaceUrl, path, outcome: "removed" });
    } catch (error) {
      const status = error.status ?? ({ ENOTEMPTY: 409, ENOENT: 404, ENOTDIR: 409, EACCES: 403, EPERM: 403 })[error.code] ?? 500;
      finish(status, { code: error.code ?? "EIO" });
    } finally {
      record.disconnected = controller.signal.aborted;
      record.finished = true;
    }
  }

  const server = createServer((incoming, response) => {
    const running = handle(incoming, response);
    pending.add(running);
    void running.finally(() => pending.delete(running));
  });
  server.requestTimeout = 3000;
  server.headersTimeout = 3000;
  server.keepAliveTimeout = 100;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  endpoint = `http://127.0.0.1:${server.address().port}/_test/atomic-rmdir`;
  namespaceUrl = `http://127.0.0.1:${server.address().port}/dav/`;
  return {
    endpoint, namespaceUrl, root, records, hooks, policyLocks,
    rootIdentity: { dev: String(rootStat.dev), ino: String(rootStat.ino) },
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await Promise.allSettled(pending);
      return { listening: server.listening, pending: pending.size };
    },
  };
}

export function send(fixture, path, options = {}) {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
  if (signal.aborted) return Promise.reject(signal.reason);
  const body = Buffer.from(JSON.stringify({ operation, namespaceUrl: fixture.namespaceUrl, path, ...options.body }));
  return new Promise((resolve, reject) => {
    const outgoing = request(fixture.endpoint, {
      method: options.method ?? "POST", signal, agent: false,
      headers: { authorization: syntheticAuthorization, "content-type": "application/json", "content-length": body.length, ...options.headers },
    }, (incoming) => {
      const chunks = [];
      let size = 0;
      incoming.on("data", (chunk) => {
        size += chunk.length;
        if (size > 4096) incoming.destroy(new Error("oversized fixture response"));
        else chunks.push(chunk);
      });
      incoming.once("error", reject);
      incoming.once("end", () => {
        try { resolve({ status: incoming.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch (error) { reject(error); }
      });
    });
    outgoing.once("error", reject);
    outgoing.end(body);
  });
}

export function validateRemoval(fixture, path, reply) {
  if (reply.status !== 200 || reply.body.operation !== operation || reply.body.namespaceUrl !== fixture.namespaceUrl
    || reply.body.path !== path || reply.body.outcome !== "removed") throw fault("EPROTOCOL", 502);
}
