import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError } from "../../../../src/contracts/errors.js";
import { ReadOnlyFileSystem } from "../../../../src/fs/readonly/index.js";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";
import { Shell } from "../../../../src/shell/index.js";
import { multistatus, resource, xmlResponse } from "../mock.js";

type Respond = (url: string, init: RequestInit, count: number) => Response | Promise<Response>;

function fixture(respond: Respond = url => xmlResponse(multistatus(resource(new URL(url).pathname, true)))) {
  const requests: { url: string; init: RequestInit; depth: string | null }[] = [];
  const filesystem = new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: async (url, init) => {
    requests.push({ url, init, depth: new Headers(init.headers).get("Depth") });
    return respond(url, init, requests.length);
  } });
  return { filesystem, requests };
}

const errno = (code: string) => (error: unknown): boolean => error instanceof FsError && error.code === code;

for (const mode of [1, 5]) {
  test(`directory mode ${mode} uses only the required metadata depths`, async () => {
    const { filesystem, requests } = fixture();
    const capabilities = { ...filesystem.capabilities };
    await filesystem.access("/folder", mode);
    assert.deepEqual(requests.map(request => request.depth), mode === 1 ? ["0"] : ["0", "1"]);
    assert.ok(requests.every(request => request.init.method === "PROPFIND" && request.init.redirect === "manual" && request.init.credentials === "omit"));
    assert.equal(filesystem.capabilities.permissions, false);
    assert.deepEqual(filesystem.capabilities, capabilities);
  });

  test(`file mode ${mode} remains unsupported without GET`, async () => {
    const { filesystem, requests } = fixture(url => xmlResponse(multistatus(resource(new URL(url).pathname, false, 1))));
    await assert.rejects(filesystem.access("/file", mode), errno("ENOTSUP"));
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.init.method, "PROPFIND");
    await assert.rejects(filesystem.access("/file/", mode), errno("ENOTDIR"));
  });

  for (const [label, accepted, rejected] of [
    ["ASCII", "/" + "a".repeat(65535), "/" + "a".repeat(65536)],
    ["two-byte UTF8", "/" + "é".repeat(32767) + "a", "/" + "é".repeat(32768)],
    ["four-byte UTF8", "/" + "😀".repeat(16383) + "abc", "/" + "😀".repeat(16384)],
    ["slashes", "/".repeat(65536), "/".repeat(65537)],
    ["components", "/a".repeat(256), "/a".repeat(257)],
    ["dot components", "/.".repeat(256), "/.".repeat(257)],
    ["removed components", "/a/..".repeat(128), "/a/..".repeat(128) + "/."],
  ]) {
    test(`mode ${mode} inclusive raw ${label} bounds precede requests`, async () => {
      const { filesystem, requests } = fixture();
      await filesystem.access(accepted!, mode);
      const before = requests.length;
      await assert.rejects(filesystem.access(rejected!, mode), errno("ENAMETOOLONG"));
      assert.equal(requests.length, before);
    });
  }

  for (const path of ["/nul\0", "/back\\slash", "/\ud800", "/\udc00"]) {
    test(`mode ${mode} preserves small invalid path ${JSON.stringify(path)}`, async () => {
      const { filesystem, requests } = fixture();
      await assert.rejects(filesystem.access(path, mode), errno("EINVAL"));
      assert.equal(requests.length, 0);
    });
  }

  test(`mode ${mode} root escape cannot make a request`, async () => {
    const { filesystem, requests } = fixture();
    await assert.rejects(filesystem.access("/../escape", mode), errno("EACCES"));
    assert.equal(requests.length, 0);
  });
}

for (const mode of [0, 4]) {
  test(`mode ${mode} does not inherit the X-bearing raw-path caps`, async () => {
    const { filesystem } = fixture();
    await filesystem.access("/".repeat(65537), mode);
    await filesystem.access("/.".repeat(257), mode);
  });
}

test("each X_OK call obtains fresh metadata; later denial is not cached away", async () => {
  const { filesystem, requests } = fixture((url, _init, count) => count === 1
    ? xmlResponse(multistatus(resource(new URL(url).pathname, true))) : new Response(null, { status: 403 }));
  await filesystem.access("/folder", 1);
  await assert.rejects(filesystem.access("/folder", 1), errno("EACCES"));
  assert.equal(requests.length, 2);
});

test("X_OK does not imply listing or child access", async () => {
  const { filesystem, requests } = fixture((url, init) => new Headers(init.headers).get("Depth") === "1" || url.endsWith("/child")
    ? new Response(null, { status: 403 }) : xmlResponse(multistatus(resource(new URL(url).pathname, true))));
  await filesystem.access("/folder", 1);
  await assert.rejects(filesystem.access("/folder", 5), errno("EACCES"));
  await assert.rejects(filesystem.stat("/folder/child"), errno("EACCES"));
  assert.deepEqual(requests.map(request => request.depth), ["0", "0", "1", "0"]);
});

test("mode5 rejects a self-file replacement in its listing without identity invention", async () => {
  const { filesystem } = fixture((url, init) => xmlResponse(multistatus(resource(new URL(url).pathname,
    new Headers(init.headers).get("Depth") === "0", 1))));
  await assert.rejects(filesystem.access("/folder", 5), errno("ENOTDIR"));
});

for (const [status, code] of [[401, "EACCES"], [403, "EACCES"], [404, "ENOENT"], [423, "EBUSY"], [500, "EIO"], [501, "ENOTSUP"]] as const) {
  test(`directory X_OK preserves HTTP${status} as ${code}`, async () => {
    const { filesystem, requests } = fixture(() => new Response(null, { status }));
    await assert.rejects(filesystem.access("/folder", 1), errno(code));
    assert.equal(requests.length, 1);
  });
}

test("missing descendant retains shallow ancestor-file ENOTDIR refinement", async () => {
  const { filesystem, requests } = fixture(url => url.endsWith("/child") ? new Response(null, { status: 404 })
    : xmlResponse(multistatus(resource(new URL(url).pathname, false, 1))));
  await assert.rejects(filesystem.access("/folder/child", 1), errno("ENOTDIR"));
  assert.deepEqual(requests.map(request => new URL(request.url).pathname), ["/dav/folder/child", "/dav/folder"]);
});

for (const mode of [-1, 8, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`invalid numeric mode ${String(mode)} precedes preabort`, async () => {
    const { filesystem, requests } = fixture();
    await assert.rejects(filesystem.access("/folder", mode, { signal: AbortSignal.abort("stop") }), errno("EINVAL"));
    assert.equal(requests.length, 0);
  });
}

for (const mode of [0, 1, 2, 3, 4, 5, 6, 7]) {
  test(`valid mode ${mode} preabort precedes provider admission and readonly delegates nonwrites`, async () => {
    const { filesystem, requests } = fixture();
    const options = { signal: AbortSignal.abort("stop") };
    await assert.rejects(filesystem.access("/folder", mode, options), errno("ECANCELED"));
    await assert.rejects(new ReadOnlyFileSystem(filesystem).access("/folder", mode, options), errno(mode & 2 ? "EROFS" : "ECANCELED"));
    assert.equal(requests.length, 0);
  });
}

for (const mode of [2, 3, 6, 7]) {
  test(`write-containing mode ${mode} is refused before long-path validation`, async () => {
    const { filesystem, requests } = fixture();
    await assert.rejects(filesystem.access("/".repeat(65537), mode), errno("ENOTSUP"));
    assert.equal(requests.length, 0);
  });
}

for (const mode of [1, 5]) {
  test(`mode ${mode} cancellation after fulfilled stat prevents type success and listing`, async () => {
    const { filesystem, requests } = fixture();
    const controller = new AbortController();
    const original = filesystem.stat.bind(filesystem);
    filesystem.stat = async (...args) => {
      const result = await original(...args);
      controller.abort(null);
      return result;
    };
    await assert.rejects(filesystem.access("/folder", mode, { signal: controller.signal }), errno("ECANCELED"));
    assert.deepEqual(requests.map(request => request.depth), ["0"]);
  });
}

test("mode5 cancellation after fulfilled readdir cannot become success", async () => {
  const { filesystem, requests } = fixture();
  const controller = new AbortController();
  const original = filesystem.readdir.bind(filesystem);
  filesystem.readdir = async (...args) => {
    const result = await original(...args);
    controller.abort(0);
    return result;
  };
  await assert.rejects(filesystem.access("/folder", 5, { signal: controller.signal }), errno("ECANCELED"));
  assert.deepEqual(requests.map(request => request.depth), ["0", "1"]);
});

test("plain and readonly cd retain existing metadata-only behavior", async () => {
  for (const readOnly of [false, true]) {
    const { filesystem, requests } = fixture();
    const selected = readOnly ? new ReadOnlyFileSystem(filesystem) : filesystem;
    await selected.access("/folder", 1);
    assert.deepEqual(requests.map(request => request.depth), ["0"]);
    requests.length = 0;
    const shell = new Shell({ fs: selected, cwd: "/", env: { HOME: "/", PATH: "" } });
    try {
      const result = await shell.exec("cd /folder; pwd");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "/folder\n");
      assert.equal(result.stderr, "");
      assert.deepEqual(requests.map(request => request.depth), ["0", "0"]);
      assert.ok(requests.every(request => request.init.method === "PROPFIND" && new URL(request.url).pathname === "/dav/folder"));
    } finally { await shell.dispose(); }
  }
});
