export type Action = "up" | "down" | "left" | "right" | "space" | "enter" | "cancel";

const aliases: Record<string, Action> = {
  k: "up",
  j: "down",
  h: "left",
  l: "right"
};

const keyActions: Record<string, Action> = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  space: "space",
  return: "enter",
  enter: "enter",
  escape: "cancel"
};

export function mapKey(name: string | undefined, char: string | undefined): Action | undefined {
  if (char === "\x03") {
    return "cancel";
  }
  if (char === " ") {
    return "space";
  }

  if (!name) {
    return undefined;
  }

  return keyActions[name] ?? aliases[name];
}
