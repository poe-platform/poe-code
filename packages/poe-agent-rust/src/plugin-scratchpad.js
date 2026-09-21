import { native } from "./native.js";
const WRITE_NOTE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    key: { type: "string" },
    value: { type: "string" }
  },
  required: ["key", "value"],
  additionalProperties: false
};
const READ_NOTE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    key: { type: "string" }
  },
  required: ["key"],
  additionalProperties: false
};
const scratchpad = () => {
  const notes = new native.NativeAgentScratchpad();
  return {
    name: "scratchpad",
    tools: [
      {
        name: "write_note",
        description: "Write a scratchpad note for this run.",
        inputSchema: WRITE_NOTE_INPUT_SCHEMA,
        policy: {
          read: false,
          edit: true
        },
        call(args) {
          const { key, value } = parseWriteNoteArgs(args);
          notes.write(key, value);
          return `Wrote '${key}'`;
        }
      },
      {
        name: "read_note",
        description: "Read a scratchpad note for this run.",
        inputSchema: READ_NOTE_INPUT_SCHEMA,
        policy: {
          read: true,
          edit: true
        },
        call(args) {
          const { key } = parseReadNoteArgs(args);
          return notes.read(key) ?? "(no note)";
        }
      }
    ]
  };
};
function parseWriteNoteArgs(args) {
  if (!isRecord(args) || typeof args.key !== "string" || typeof args.value !== "string") {
    throw new Error("write_note requires string key and value.");
  }
  return {
    key: args.key,
    value: args.value
  };
}
function parseReadNoteArgs(args) {
  if (!isRecord(args) || typeof args.key !== "string") {
    throw new Error("read_note requires a string key.");
  }
  return {
    key: args.key
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export default scratchpad;
