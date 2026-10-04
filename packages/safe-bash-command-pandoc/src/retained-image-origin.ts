import type {ExecutionContext} from "./execution.js";

/** Classify paths and URLs without an authority using bounded state. Authorities
 * replay only their host/port into native validation, including file URLs. */
export async function retainedImageOriginAllowed(chunks: () => AsyncIterable<string>, context: ExecutionContext): Promise<boolean> {
  let state: "leading" | "scheme" | "body" | "slash" | "fileFirst" | "fileSecond" | "slashes" | "authority" | "authorityEnd" | "accept" | "reject" = "leading";
  let scheme = "", first = true, special = false, offset = 0, hostStart = 0, hostEnd = -1, credentials = false;
  for await (const part of chunks()) {
    // Preserve the old whole-value admission charge, including rejected values.
    context.charge("retainedBytes", part.length * 2);
    for (const char of part) {
      const position = offset; offset += char.length;
      if (first) {first = false; if (char === "/") state = "accept";}
      if (state === "accept" || state === "reject" || state === "authorityEnd") continue;
      if (char === "\t" || char === "\r" || char === "\n") continue;
      if (state === "leading" && char.charCodeAt(0) <= 32) continue;
      if (state === "fileFirst" || state === "fileSecond") {
        const slash = char === "/" || char === "\\";
        state = slash ? state === "fileFirst" ? "fileSecond" : "authority" : "accept";
        hostStart = offset; continue;
      }
      if (state === "slashes") {
        if (char === "/" || char === "\\") {hostStart = offset; continue;}
        state = "authority";
      }
      if (state === "authority") {
        if (char === "/" || char === "?" || char === "#" || special && char === "\\") {hostEnd = position; state = "authorityEnd";}
        else if (char === "@") {credentials = true; hostStart = offset;}
        continue;
      }
      const letter = char >= "a" && char <= "z" || char >= "A" && char <= "Z";
      if (state === "leading") {
        if (!letter) {state = "reject"; continue;}
        state = "scheme"; scheme = char.toLowerCase();
      } else if (state === "scheme") {
        if (char === ":") {
          special = ["ftp", "file", "http", "https", "ws", "wss"].includes(scheme);
          state = scheme === "file" ? "fileFirst" : special ? "slashes" : "body";
          hostStart = offset;
        }
        else if (letter || char >= "0" && char <= "9" || char === "+" || char === "-" || char === ".") {
          if (scheme.length < 6) scheme += char.toLowerCase();
        } else state = "reject";
      } else if (state === "body") state = char === "/" ? "slash" : "accept";
      else if (state === "slash") {state = char === "/" ? "authority" : "accept"; hostStart = offset;}
    }
    await context.cooperate(0);
  }
  if (state === "authority" || state === "authorityEnd" || state === "slashes") {
    const finish = hostEnd < 0 ? offset : hostEnd;
    let authority = "", position = 0;
    for await (const part of chunks()) {
      const end = position + part.length;
      if (end > hostStart && position < finish) authority += part.slice(Math.max(0, hostStart - position), Math.min(part.length, finish - position));
      position = end; await context.cooperate(0);
      if (position >= finish) break;
    }
    return URL.canParse(`${special ? scheme : "x"}://${credentials ? "x@" : ""}${authority}${hostEnd < 0 ? "" : "/"}`);
  }
  return state === "accept" || state === "body" || state === "slash" || state === "fileFirst" || state === "fileSecond";
}
