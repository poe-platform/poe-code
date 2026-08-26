import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Shell, agentCommands, createAgentCommands, createMemoryFileSystem, networkCommands, curlCommands,
  createNetworkCommands, createCurlCommands, createCurlCommand, createNodeHttpTransport,
  defaultNetworkLimits, CurlError, toByteSource, type NetworkCommandsOptions,
} from "../../../src/index.js";

test("root exposes the explicit usable network capability without altering aggregate", async () => {
  assert.equal(createAgentCommands().some(command => command.name === "curl"), false);
  assert.equal(networkCommands, curlCommands); assert.equal(createNetworkCommands, createCurlCommands);
  assert.equal(typeof createNodeHttpTransport(), "function"); assert.ok(defaultNetworkLimits.maxDownloadBytes > 0);
  const seen: string[] = [];
  const options: NetworkCommandsOptions = {
    authorize: request => request.url === "http://allowed.test/data",
    transport: async request => {
      seen.push(request.url);
      return { status: 200, statusText: "OK", headers: [], body: toByteSource("injected bytes"), async dispose() {} };
    },
  };
  assert.equal(createCurlCommand(options).name, "curl");
  assert.deepEqual(createNetworkCommands(options).map(command => command.name), ["curl"]);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands()).use(networkCommands(options));
  try {
    const result = await shell.exec("curl http://allowed.test/data | cat");
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, "injected bytes");
    assert.deepEqual(seen, ["http://allowed.test/data"]);
    const before = shell.commands.list();
    await assert.rejects(async () => networkCommands(options).setup(shell), /already registered/);
    assert.deepEqual(shell.commands.list(), before);
    await networkCommands({ ...options, replace: true }).setup(shell);
    assert.equal(shell.commands.list().length, before.length);
    const error = new CurlError(63, "bounded"); assert.equal(error.exitCode, 63);
  } finally { await shell.dispose(); }
});
