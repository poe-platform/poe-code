import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("uses an injected ACP transport without Node compatibility", async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("./client.ts", import.meta.url))], bundle: true,
    write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "acp", logLevel: "silent" });
  const { AcpClient } = new Function(`${bundle.outputFiles[0].text}; return acp;`)();
  const methods: string[] = [];
  const client = new AcpClient({ transport: {
    onRequest() {}, onNotification() {}, sendNotification() {},
    async sendRequest(method: string) {
      methods.push(method);
      if (method === "initialize") return { protocolVersion: 1, agentCapabilities: {} };
      return { sessionId: "portable" };
    }
  } });
  await client.initialize({});
  expect(await client.newSession("/repo", [])).toMatchObject({ sessionId: "portable" });
  expect(methods).toEqual(["initialize", "session/new"]);
});
