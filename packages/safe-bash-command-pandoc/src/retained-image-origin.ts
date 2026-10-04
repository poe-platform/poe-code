import {AsciiUrlHost} from "./ascii-url-host.js";
import type {ExecutionContext} from "./execution.js";

/** Classify paths and URLs without an authority using bounded state. Authorities
 * scan ports and opaque hosts; only special-scheme IDNA hostnames still require
 * whole-value native validation. IPv6 literals fit a format-bounded buffer. */
export async function retainedImageOriginAllowed(chunks: () => AsyncIterable<string>, context: ExecutionContext): Promise<boolean> {
  let state: "leading" | "scheme" | "body" | "slash" | "fileFirst" | "fileSecond" | "slashes" | "authority" | "authorityEnd" | "accept" | "reject" = "leading";
  let scheme = "", first = true, special = false, offset = 0, trimEnd = 0, hostStart = 0, hostEnd = -1, credentials = false;
  for await (const part of chunks()) {
    // Preserve the old whole-value admission charge, including rejected values.
    context.charge("retainedBytes", part.length * 2);
    for (const char of part) {
      const position = offset; offset += char.length;
      if (char.charCodeAt(0) > 32) trimEnd = offset;
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
    const finish = hostEnd < 0 ? trimEnd : hostEnd;
    const ascii = new AsciiUrlHost(); let hostnameEnd = finish;
    let authority = "", position = 0, bracket = false, portStarted = false, portDigits = false, port = 0, hostSeen = false, ipv6 = false;
    for await (const part of chunks()) {
      const end = position + part.length;
      let cursor = Math.max(position, hostStart);
      if (end > hostStart && position < finish) for (const char of part.slice(Math.max(0, hostStart - position), Math.min(part.length, finish - position))) {
        const charPosition = cursor; cursor += char.length;
        if (char === "\t" || char === "\r" || char === "\n") continue;
        if (portStarted) {
          if (scheme === "file" || char < "0" || char > "9") return false;
          port = port * 10 + char.charCodeAt(0) - 48; portDigits = true;
          if (port > 65535) return false;
        } else if (char === ":" && !bracket) {portStarted = true; hostnameEnd = charPosition;}
        else {
          if (!hostSeen) {hostSeen = true; ipv6 = char === "[";}
          if (!special && !ipv6) {
            if (char === "\0" || " #/:<>?@[\\]^|".includes(char)) return false;
            authority = "x";
          } else if (special && !ipv6) ascii.write(char);
          else {
            authority += char;
            // Eight 16-bit groups, or six groups and an IPv4 tail, fit in 47
            // characters including brackets. Longer literals cannot be IPv6.
            if (ipv6 && authority.length > 47) return false;
          }
          if (char === "[") bracket = true; else if (char === "]") bracket = false;
        }
      }
      position = end; await context.cooperate(0);
      if (position >= finish) break;
    }
    if (special && !ipv6) {
      const valid = ascii.finish();
      if (valid === false && !(scheme === "file" && ascii.windowsDrive && !portStarted)) return false;
      if (scheme === "file" && ascii.windowsDrive && !portStarted) authority = ascii.windowsDrive;
      else if (valid === undefined) {
        position = 0;
        for await (const part of chunks()) {
          const end = position + part.length;
          if (end > hostStart && position < hostnameEnd) authority += part.slice(Math.max(0, hostStart - position), Math.min(part.length, hostnameEnd - position));
          position = end; await context.cooperate(0);
          if (position >= hostnameEnd) break;
        }
      } else if (scheme === "file" && portStarted) {
        if (!ascii.singleLetter) return false;
        authority = ascii.singleLetter;
      } else authority = hostSeen ? "host.invalid" : "";
    }
    if (portStarted) authority += ":";
    if (portDigits) authority += String(port);
    return URL.canParse(`${special ? scheme : "x"}://${credentials ? "x@" : ""}${authority}${hostEnd < 0 ? "" : "/"}`);
  }
  return state === "accept" || state === "body" || state === "slash" || state === "fileFirst" || state === "fileSecond";
}
