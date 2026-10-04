import type {ExecutionContext} from "./execution.js";

/** Classify paths and URLs without an authority using bounded state. Special
 * schemes and authorities still use native URL validation on a replayed value. */
export async function retainedImageOriginAllowed(chunks: () => AsyncIterable<string>, context: ExecutionContext): Promise<boolean> {
  let state: "leading" | "scheme" | "body" | "slash" | "native" | "accept" | "reject" = "leading";
  let scheme = "", first = true;
  for await (const part of chunks()) {
    // Preserve the old whole-value admission charge, including rejected values.
    context.charge("retainedBytes", part.length * 2);
    for (const char of part) {
      if (first) {first = false; if (char === "/") state = "accept";}
      if (state === "accept" || state === "reject" || state === "native") continue;
      if (char === "\t" || char === "\r" || char === "\n") continue;
      if (state === "leading" && char.charCodeAt(0) <= 32) continue;
      const letter = char >= "a" && char <= "z" || char >= "A" && char <= "Z";
      if (state === "leading") {
        if (!letter) {state = "reject"; continue;}
        state = "scheme"; scheme = char.toLowerCase();
      } else if (state === "scheme") {
        if (char === ":") state = ["ftp", "file", "http", "https", "ws", "wss"].includes(scheme) ? "native" : "body";
        else if (letter || char >= "0" && char <= "9" || char === "+" || char === "-" || char === ".") {
          if (scheme.length < 6) scheme += char.toLowerCase();
        } else state = "reject";
      } else if (state === "body") state = char === "/" ? "slash" : "accept";
      else if (state === "slash") state = char === "/" ? "native" : "accept";
    }
    await context.cooperate(0);
  }
  if (state !== "native") return state === "accept" || state === "body" || state === "slash";
  let value = "";
  for await (const part of chunks()) {value += part; await context.cooperate(0);}
  return URL.canParse(value);
}
