import type { AgentPlugin } from "../runtime/plugin-types.js";
import { getRequiredString } from "./plugin-args.js";

const spawn = (): AgentPlugin => ({
  name: "spawn",
  tools: [false, true].map((fork) => ({
    name: fork ? "fork" : "spawn",
    ...(fork ? {} : { description: "Spawn a fresh sub-agent to handle a sub-task" }),
    policy: { read: true, edit: true },
    inputSchema: {
      type: "object",
      properties: { task: { type: "string" } },
      required: ["task"],
      additionalProperties: false
    },
    async call(args, ctx) {
      const task = getRequiredString(args, "task");
      if (!ctx.delegate) throw new Error("Asynchronous delegation requires an owned AgentSession.");
      return JSON.stringify({ id: await ctx.delegate(task, fork), status: "running" });
    }
  }))
});

export default spawn;
