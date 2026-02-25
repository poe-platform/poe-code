import { describe, expect, it, vi } from "vitest";
import { AcpClient } from "./acp-client.js";
import type { SessionUpdateNotification } from "./types.js";

const MOCK_AGENT_SCRIPT = `
const readline = require("node:readline");

const lineReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let nextRequestId = 0;
const pendingRequests = new Map();

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function sendRequest(method, params) {
  const id = "agent-" + String(++nextRequestId);
  send({
    jsonrpc: "2.0",
    id,
    method,
    params,
  });

  return new Promise((resolve, reject) => {
    pendingRequests.set(String(id), { resolve, reject });
  });
}

lineReader.on("line", (line) => {
  if (line.trim().length === 0) {
    return;
  }

  const message = JSON.parse(line);
  if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
    const pendingRequest = pendingRequests.get(String(message.id));
    if (!pendingRequest) {
      return;
    }

    pendingRequests.delete(String(message.id));
    if (message.error) {
      pendingRequest.reject(new Error(String(message.error.message)));
      return;
    }

    pendingRequest.resolve(message.result);
    return;
  }

  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            image: false,
            audio: false,
            embeddedContext: false,
          },
        },
        agentInfo: {
          name: "mock-agent",
          version: process.env.ACP_CLIENT_TEST_FLAG || "missing-env",
        },
      },
    });
    return;
  }

  if (message.method === "session/new") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        sessionId: "session-integration",
      },
    });
    return;
  }

  if (message.method === "session/prompt") {
    (async () => {
      const permissionResult = await sendRequest("session/request_permission", {
        sessionId: message.params.sessionId,
        toolCall: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          title: "Read context",
        },
        options: [
          {
            optionId: "allow-once",
            kind: "allow_once",
            name: "Allow once",
          },
        ],
      });

      const readFileResult = await sendRequest("fs/read_text_file", {
        sessionId: message.params.sessionId,
        path: "/workspace/notes.txt",
      });

      const terminalResult = await sendRequest("terminal/create", {
        sessionId: message.params.sessionId,
        command: "echo",
        args: ["integration"],
        cwd: "/workspace",
      });

      await sendRequest("terminal/release", {
        sessionId: message.params.sessionId,
        terminalId: terminalResult.terminalId,
      });

      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text:
                "permission=" +
                permissionResult.outcome.outcome +
                ";file=" +
                readFileResult.content +
                ";terminal=" +
                terminalResult.terminalId,
            },
          },
        },
      });

      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          stopReason: "completed",
        },
      });
    })().catch((error) => {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32603,
          message: String(error instanceof Error ? error.message : error),
        },
      });
    });
  }
});
`;

async function collectUpdates(
  turn: AsyncIterable<SessionUpdateNotification>
): Promise<SessionUpdateNotification[]> {
  const updates: SessionUpdateNotification[] = [];
  for await (const update of turn) {
    updates.push(update);
  }

  return updates;
}

describe("AcpClient integration", () => {
  it("runs full ACP lifecycle over a mock subprocess through the high-level facade", async () => {
    const permission = vi.fn(async () => ({ outcome: "selected" as const, optionId: "allow-once" }));
    const readTextFile = vi.fn(async () => "hello-from-client-fs");
    const terminalCreate = vi.fn(async () => "term-integration");
    const terminalRelease = vi.fn(async () => {});

    const client = new AcpClient({
      command: process.execPath,
      args: ["-e", MOCK_AGENT_SCRIPT],
      env: {
        ...process.env,
        ACP_CLIENT_TEST_FLAG: "from-client-env",
      },
      clientCapabilities: {
        fs: { readTextFile: true },
        terminal: true,
      },
      handlers: {
        permission,
        fs: {
          readTextFile,
        },
        terminal: {
          create: terminalCreate,
          output: async () => ({ output: "", truncated: false }),
          waitForExit: async () => ({ exitCode: 0 }),
          kill: async () => {},
          release: terminalRelease,
        },
      },
    });

    try {
      const initializeResult = await client.initialize();
      const session = await client.newSession("/workspace", []);
      const turn = client.prompt(session.sessionId, [{ type: "text", text: "hello" }]);
      const updatesPromise = collectUpdates(turn);
      const promptResult = await turn.response;
      const updates = await updatesPromise;

      expect(initializeResult.protocolVersion).toBe(1);
      expect(client.agentCapabilities).toMatchObject({ loadSession: true });
      expect(client.agentInfo).toEqual({ name: "mock-agent", version: "from-client-env" });
      expect(promptResult).toEqual({ stopReason: "completed" });
      expect(updates).toHaveLength(1);
      expect(updates[0]?.params.update).toEqual({
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text:
            "permission=selected;file=hello-from-client-fs;terminal=term-integration",
        },
      });
      expect(permission).toHaveBeenCalledTimes(1);
      expect(readTextFile).toHaveBeenCalledWith({
        sessionId: "session-integration",
        path: "/workspace/notes.txt",
        line: undefined,
        limit: undefined,
      });
      expect(terminalCreate).toHaveBeenCalledWith({
        sessionId: "session-integration",
        command: "echo",
        args: ["integration"],
        cwd: "/workspace",
        env: undefined,
        outputByteLimit: undefined,
      });
      expect(terminalRelease).toHaveBeenCalledWith({
        sessionId: "session-integration",
        terminalId: "term-integration",
      });
    } finally {
      await client.dispose();
    }
  });
});
