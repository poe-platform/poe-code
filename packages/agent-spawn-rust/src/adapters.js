import { native } from "./native.js";
function adapter(format) {
  return async function* (lines) {
    const state = new native.NativeSpawnAdapter(format);
    for await (const line of lines)
      for (const packet of state.line(line)) {
        const event = packet.value;
        for (const path of packet.undefinedPaths) {
          let target = event;
          for (const key of path.slice(0, -1)) target = target[key];
          target[path.at(-1)] = undefined;
        }
        if (packet.malformed) event.stack = new SyntaxError("Malformed adapter JSON line").stack;
        yield event;
      }
  };
}
export const adaptNative = adapter("native"),
  adaptClaude = adapter("claude"),
  adaptCodex = adapter("codex"),
  adaptCursor = adapter("cursor"),
  adaptOpenCode = adapter("opencode"),
  adaptPi = adapter("pi"),
  TOOL_KIND_MAP = native.spawnClaudeKinds();
const registry = Object.assign(Object.create(null), {
  native: adaptNative,
  claude: adaptClaude,
  codex: adaptCodex,
  cursor: adaptCursor,
  opencode: adaptOpenCode,
  pi: adaptPi
});
export function getAdapter(type) {
  const value = registry[type];
  if (!value) throw Error(`Unknown adapter "${String(type)}".`);
  return value;
}
