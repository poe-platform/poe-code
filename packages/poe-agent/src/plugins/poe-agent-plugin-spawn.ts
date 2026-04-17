import type { AgentPlugin } from "../runtime/plugin-types.js";

const spawn = (): AgentPlugin => ({
  name: "spawn",
  tools: [
    {
      name: "spawn",
      description: "Spawn a fresh sub-agent to handle a sub-task",
      policy: {
        read: true,
        edit: true
      },
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string"
          }
        },
        required: ["task"]
      },
      async call(args, ctx) {
        const result = await ctx.spawn((args as { task: string }).task);
        return result.output;
      }
    }
  ]
});

export default spawn;
