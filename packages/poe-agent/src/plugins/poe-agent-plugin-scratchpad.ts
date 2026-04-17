import type { AgentPlugin } from "../runtime/plugin-types.js";

const scratchpad = (): AgentPlugin => {
  const notes = new Map<string, string>();

  return {
    name: "scratchpad",
    tools: [
      {
        name: "write_note",
        policy: {
          read: false,
          edit: true
        },
        call(args) {
          const { key, value } = args as { key: string; value: string };
          notes.set(key, value);
          return `Wrote '${key}'`;
        }
      },
      {
        name: "read_note",
        policy: {
          read: true,
          edit: true
        },
        call(args) {
          return notes.get((args as { key: string }).key) ?? "(no note)";
        }
      }
    ]
  };
};

export default scratchpad;
