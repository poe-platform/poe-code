import * as agentSpawnApi from "@poe-code/agent-spawn";
import {
  adaptClaude,
  adaptCodex,
  adaptNative,
  agentSpawn,
  getAdapter,
  readLines,
  renderAcpStream,
  listMcpSupportedAgents,
  supportsMcpAtSpawn,
  spawn,
  spawnInteractive,
  spawnStreaming
} from "@poe-code/agent-spawn";

describe("@poe-code/agent-spawn", () => {
  it("exports a placeholder", () => {
    expect(agentSpawn).toEqual({});
  });

  it("exports streaming + adapters API", () => {
    expect(typeof spawn).toBe("function");
    expect(typeof spawnInteractive).toBe("function");
    expect(typeof spawnStreaming).toBe("function");
    expect(typeof readLines).toBe("function");
    expect(typeof renderAcpStream).toBe("function");
    expect(typeof adaptCodex).toBe("function");
    expect(typeof adaptClaude).toBe("function");
    expect(typeof adaptNative).toBe("function");
    expect(typeof getAdapter).toBe("function");
    expect(typeof supportsMcpAtSpawn).toBe("function");
    expect(typeof listMcpSupportedAgents).toBe("function");
  });

  it("does not export internal helpers", () => {
    expect("truncate" in agentSpawnApi).toBe(false);
  });
});
