import assert from "node:assert/strict";
import { test } from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { snapshotPersistenceOptions } from "../dist/session-store.js";
import { createDefaultOAuthClientProvider } from "../dist/index.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport(
  "../../mcp-oauth/src/client/default-oauth-client-provider.ts",
  import.meta.url
);

test("persistence snapshots retain declared hidden backend policies without constructing stores", () => {
  for (const field of ["backend", "env", "platform", "backendEnvVar"]) {
    const options = {
      backend: "file",
      env: { SELECT_BACKEND: "keychain" },
      platform: "linux",
      backendEnvVar: "SELECT_BACKEND"
    };
    Object.defineProperty(options, field, { enumerable: false });
    const selected = snapshotPersistenceOptions(options);
    assert.equal(selected.backend, "file");
    assert.equal(selected.env, options.env);
    assert.equal(selected.platform, options.platform);
    assert.equal(selected.backendEnvVar, options.backendEnvVar);
  }
});
test("persistence snapshots retain file dependencies and live private method receivers", () => {
  class FileHost {
    #directory = "/initial";
    fs = createFsFromVolume(new Volume()).promises;
    salt = "fixture";
    getHomeDirectory() {
      return this.#directory;
    }
    getMachineIdentity() {
      return { hostname: "fixture", username: this.#directory };
    }
    getRandomBytes(size) {
      return Buffer.alloc(size, this.#directory.length);
    }
    move(directory) {
      this.#directory = directory;
    }
  }
  const host = new FileHost();
  Object.defineProperty(host, "fs", { enumerable: false });
  const selected = snapshotPersistenceOptions({ backend: "file", fileStore: host }).fileStore;
  assert.equal(selected.fs, host.fs);
  host.move("/changed");
  assert.equal(selected.getHomeDirectory(), "/changed");
  assert.equal(selected.getMachineIdentity().username, "/changed");
  assert.deepEqual(selected.getRandomBytes(3), Buffer.alloc(3, 8));
  assert.notEqual(selected, host);
});
test("persistence snapshots retain keychain receivers and hidden lock dependencies", async () => {
  class KeychainHost {
    #value = "owned";
    service = "fixture";
    account = "user";
    lock = { fs: createFsFromVolume(new Volume()).promises, directory: "/synthetic/locks" };
    async runCommand() {
      return { stdout: this.#value, stderr: "", exitCode: 0 };
    }
  }
  const host = new KeychainHost();
  for (const key of ["fs", "directory"])
    Object.defineProperty(host.lock, key, { enumerable: false });
  const selected = snapshotPersistenceOptions({
    backend: "keychain",
    platform: "darwin",
    keychainStore: host
  }).keychainStore;
  assert.deepEqual(await selected.runCommand(), { stdout: "owned", stderr: "", exitCode: 0 });
  assert.equal(selected.lock.fs, host.lock.fs);
  assert.equal(selected.lock.directory, host.lock.directory);
});
test("initial lifetime clocks observe live host state after persistence construction", async () => {
  const results = [];
  for (const make of [
    original.createDefaultOAuthClientProvider,
    createDefaultOAuthClientProvider
  ]) {
    class Host {
      #timestamp = 1000;
      client = { mode: "static", clientId: "original" };
      browser = {};
      allowInteractive = false;
      resourceIdentity = "catalog";
      initialGrant = {
        resource: "https://resource.example/mcp",
        tokens: { accessToken: "original-grant", tokenType: "Bearer", expiresIn: 1 }
      };
      now() {
        return this.#timestamp;
      }
      advance() {
        this.#timestamp = 4000;
      }
    }
    const host = new Host();
    host.authStore = {
      backend: "file",
      fileStore: {
        fs: createFsFromVolume(new Volume()).promises,
        salt: "fixture",
        getHomeDirectory() {
          host.advance();
          return "/synthetic";
        }
      }
    };
    const provider = make(host),
      headers = new Headers();
    await provider.authorizeRequest({
      requestUrl: new URL(host.initialGrant.resource),
      headers,
      fetch() {
        throw Error("unexpected network");
      }
    });
    results.push(headers.get("Authorization"));
  }
  assert.equal(results[0], "Bearer original-grant");
  assert.deepEqual(results, [results[0], results[0]]);
});
