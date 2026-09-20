import { describe, expect, it } from "vitest";
import { acp, withOutputFormat } from "toolcraft-design";
import { renderAcpEvent, renderSessionUpdateStream } from "./renderer.js";
import type { PlanEvent } from "./types.js";

describe("agent checklist output routes", () => {
  const entries: PlanEvent["entries"] = [{ content: "Verify changes", priority: "medium", status: "in_progress" }];

  it("renders a structured checklist instead of the unknown event name", async () => {
    const lines: string[] = [];
    await acp.withAcpWriter((line) => lines.push(line), async () => withOutputFormat("json", () => {
      renderAcpEvent({ event: "plan", entries });
    }));
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ event: "plan", entries }]);
  });

  it("renders checklist updates when replaying an ACP stream", async () => {
    const lines: string[] = [];
    await acp.withAcpWriter((line) => lines.push(line), async () => withOutputFormat("json", async () => {
      await renderSessionUpdateStream((async function* () {
        yield { sessionUpdate: "plan" as const, entries };
        yield { sessionUpdate: "plan" as const, entries: [] };
      })());
    }));
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ event: "plan", entries }, { event: "plan", entries: [] }]);
  });
});
