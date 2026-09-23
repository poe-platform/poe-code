import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { agentCommands } from "../../src/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { creationFileSystem } from "../../src/shell/umask.js";
import { scopeFileSystem } from "@poe-code/safe-fs/core";
import { MockS3Client, S3FileSystem } from "../../src/fs/s3/index.js";

for (const pathOverride of [false, true]) {
  test(`umask omits implicit modes for permissionless adapters: path override=${pathOverride}`, async () => {
    const backing = createMemoryFileSystem();
    const modes: unknown[] = [];
    const fs = new Proxy(backing, {
      get(target, key) {
        if (key === "capabilities") return { ...target.capabilities, permissions: pathOverride };
        if (key === "capabilitiesFor") return async () => ({ ...target.capabilities, permissions: false });
        const member: unknown = Reflect.get(target, key, target);
        if (typeof member !== "function") return member;
        if (["writeFile", "appendFile", "mkdir", "open"].includes(String(key))) return (...args: unknown[]) => {
          const index = key === "writeFile" || key === "appendFile" ? 2 : 1;
          const options = args[index] as { mode?: number } | undefined;
          modes.push(options?.mode);
          assert.equal(options?.mode, undefined, `${String(key)} must not imply permissions`);
          return Reflect.apply(member, target, args);
        };
        return member.bind(target);
      },
    });
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec("umask 077; touch file; mkdir dir; echo hi >redirect; echo hi >>append");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(new TextDecoder().decode(await backing.readFile("/redirect")), "hi\n");
      assert.ok(modes.length >= 4);
    } finally { await shell.dispose(); }
  });
}

test("umask preserves explicit creation modes on permissionless adapters", async () => {
  const backing = createMemoryFileSystem();
  const fs = new Proxy(backing, {
    get(target, key) {
      if (key === "capabilities") return { ...target.capabilities, permissions: false };
      if (key === "capabilitiesFor") return async () => ({ ...target.capabilities, permissions: false });
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  await creationFileSystem(fs, 0o077).mkdir("/explicit", { mode: 0o755 });
  assert.equal((await backing.stat("/explicit")).mode & 0o777, 0o755);
});

test("umask creation views preserve known comparison peers and leave unknown peers opaque", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/source", new Uint8Array([1]));
  await fs.writeFile("/target", new Uint8Array([2]));
  const compare = fs.compareEntry.bind(fs);
  const peers: unknown[] = [];
  fs.compareEntry = async (path, peer, peerPath, options) => {
    peers.push(peer);
    return compare(path, peer, peerPath, options);
  };
  const first = creationFileSystem(fs, 0o077);
  const second = creationFileSystem(fs, 0o022);
  assert.equal(await first.compareEntry!("/source", second, "/target"), "distinct");
  assert.equal(await first.compareEntry!("/source", first, "/source"), "same");
  const opaquePeer = createMemoryFileSystem();
  await opaquePeer.writeFile("/target", new Uint8Array([3]));
  assert.equal(await first.compareEntry!("/source", opaquePeer, "/target"), "distinct");
  assert.equal(peers.length, 3);
  assert.equal(peers[0], second);
  assert.equal(peers[1], first);
  assert.equal(peers[2], opaquePeer);
});

test("umask views preserve provider authority in both directions through nested scoped views", async () => {
  const fs = new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" });
  await fs.writeFile("/source", new Uint8Array([1]));
  await fs.writeFile("/target", new Uint8Array([2]));
  assert.equal((await fs.stat("/source")).identityScope, undefined);
  const first = creationFileSystem(fs, 0o022);
  const nested = creationFileSystem(first, 0o077);
  const controller = new AbortController();
  let operations = 0;
  const scoped = scopeFileSystem(nested, () => { operations++; }, controller.signal);
  for (const view of [first, nested, scoped]) {
    assert.equal(await view.compareEntry!("/source", view, "/target"), "distinct");
    assert.equal(await fs.compareEntry("/source", view, "/target"), "distinct");
    assert.equal(await view.compareEntry!("/source", fs, "/source"), "same");
    assert.equal(await fs.compareEntry("/source", view, "/source"), "same");
  }
  assert.ok(operations > 0);
  const opaque = new Proxy(fs, {
    get(target, key) {
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  assert.equal(await first.compareEntry!("/source", opaque, "/target"), "unknown");
  assert.equal(await fs.compareEntry("/source", opaque, "/source"), "unknown");
});

test("umask comparison forwarding preserves cancellation reason identity", async () => {
  const fs = createMemoryFileSystem();
  fs.compareEntry = async (_path, _peer, _peerPath, options) => {
    options?.signal?.throwIfAborted();
    return "unknown";
  };
  const view = creationFileSystem(fs, 0o022);
  for (const reason of [null, false, 0, "", NaN]) {
    const controller = new AbortController();
    controller.abort(reason);
    await assert.rejects(view.compareEntry!("/source", view, "/target", { signal: controller.signal }), error => Object.is(error, reason));
  }
});

test("umask masks new files, directories and redirects without changing existing modes", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  const result = await shell.exec("umask 077; touch file; mkdir dir; echo hi >redirect; echo hi >>append; umask");
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "0077\n");
  for (const path of ["/file", "/redirect", "/append"]) assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  assert.equal((await fs.stat("/dir")).mode & 0o777, 0o700);
  await fs.chmod("/file", 0o644);
  await shell.exec("umask 077; echo changed >file");
  assert.equal((await fs.stat("/file")).mode & 0o777, 0o644);
});

test("umask is inherited by children and isolated between executions", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  const result = await shell.exec("umask 077; (umask; umask 022); umask; sh -c 'umask'; echo \"$(umask)\"");
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "0077\n0077\n0077\n0077\n");
  assert.equal((await shell.exec("umask")).stdout, "0022\n");
});

test("umask supports symbolic modes and reusable output, and rejects invalid input", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  const result = await shell.exec("umask 077; umask -S; umask -p; umask u=rwx,g=rx,o=; umask");
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "u=rwx,g=,o=\numask 0077\n0027\n");
  assert.equal((await shell.exec("umask 088")).exitCode, 1);
  assert.equal((await shell.exec("umask 077; umask -pS")).stdout, "umask -S u=rwx,g=,o=\n");
});

test("umask reaches sequential-only redirect adapters and respects explicit mkdir modes", async () => {
  const fs = createMemoryFileSystem();
  const sequential = new Proxy(fs, {
    get(target, key) {
      if (key === "capabilities") return { ...target.capabilities, open: false, randomAccessWrite: false };
      if (key === "capabilitiesFor" || key === "open") return undefined;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const shell = new Shell({ fs: sequential }).use(agentCommands());
  const result = await shell.exec("umask 077; echo hi >out; echo hi >>app; mkdir -m 755 explicit");
  assert.equal(result.stderr, "");
  assert.equal((await fs.stat("/out")).mode & 0o777, 0o600);
  assert.equal((await fs.stat("/app")).mode & 0o777, 0o600);
  assert.equal((await fs.stat("/explicit")).mode & 0o777, 0o755);
});

test("literal command invocation inherits the mask without affecting concurrent executions", async () => {
  const fs = createMemoryFileSystem();
  const commands = new CommandRegistry();
  commands.register({ name: "child", async execute(context) {
    return context.invoke!("sh", ["-c", "touch child-file; umask 022"]);
  } });
  const shell = new Shell({ fs, commands }).use(agentCommands());
  const results = await Promise.all([
    shell.exec("umask 077; child; touch private-file; umask"),
    shell.exec("umask 002; touch shared-file; umask"),
  ]);
  assert.deepEqual(results.map(result => result.stderr), ["", ""]);
  assert.deepEqual(results.map(result => result.stdout), ["0077\n", "0002\n"]);
  for (const path of ["/child-file", "/private-file"]) assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  assert.equal((await fs.stat("/shared-file")).mode & 0o777, 0o664);
});
