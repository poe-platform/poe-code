import { HtmlBudget, type HtmlAttribute } from "./contracts.js";
import { asciiLower, decodeEntities, htmlSpace } from "./entities.js";
export type HtmlToken =
  | { kind: "text" | "comment" | "doctype"; data: string }
  | { kind: "start" | "end"; name: string; attributes: HtmlAttribute[]; selfClosing: boolean };
export const rawElements = new Set([
  "script",
  "style",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "noscript"
]);
export const voidElements = new Set([
  "area",
  "base",
  "basefont",
  "bgsound",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);
function replaceNulls(text: string, replacement = "\ufffd"): string {
  return text.includes("\0") ? text.replaceAll("\0", replacement) : text;
}

export class HtmlTokenizer {
  private position = 0;
  constructor(
    private readonly source: string,
    private readonly budget: HtmlBudget
  ) {
    this.budget.charge("work", source.length * 2);
  }
  private cut(start: number, from: number, to = this.source.length): string {
    const end = Math.min(this.source.length, to);
    this.budget.bound("tokenBytes", Math.max(0, end - start) * 2);
    this.budget.charge("work", Math.max(0, end - from) * 33);
    return this.source.slice(from, end);
  }
  private look(from: number, to: number): string {
    this.budget.charge("work", Math.min(this.source.length, to) - from);
    return this.source.slice(from, to);
  }
  private finish(start: number, token: HtmlToken): HtmlToken {
    this.budget.bound("tokenBytes", (this.position - start) * 2);
    this.budget.charge("work", this.position - start + 1);
    return token;
  }
  next(raw?: string, foreign = false): HtmlToken | undefined {
    const s = this.source;
    const start = this.position;
    if (start >= s.length) return undefined;
    this.budget.check();
    let end = start;
    if (raw) {
      if (raw === "plaintext") end = s.length;
      else {
        end = start;
        let scriptState: "data" | "escaped" | "double" = "data";
        while (end < s.length) {
          if (raw === "script") {
            if (scriptState === "data" && s.startsWith("<!--", end)) {
              scriptState = "escaped";
              end += 4;
              continue;
            }
            if (scriptState !== "data" && s.startsWith("-->", end)) {
              scriptState = "data";
              end += 3;
              continue;
            }
            const opening =
              asciiLower(this.look(end, end + 7)) === "<script" &&
              (htmlSpace(s[end + 7] ?? "") || s[end + 7] === "/" || s[end + 7] === ">");
            const closing =
              asciiLower(this.look(end, end + 8)) === "</script" &&
              (htmlSpace(s[end + 8] ?? "") || s[end + 8] === "/" || s[end + 8] === ">");
            if (scriptState === "escaped" && opening) {
              scriptState = "double";
              end += 7;
              continue;
            }
            if (scriptState === "double" && closing) {
              scriptState = "escaped";
              end += 8;
              continue;
            }
            if (scriptState === "double") {
              end++;
              continue;
            }
          }
          if (
            s[end] === "<" &&
            s[end + 1] === "/" &&
            asciiLower(this.look(end + 2, end + 2 + raw.length)) === raw &&
            (htmlSpace(s[end + 2 + raw.length] ?? "") ||
              s[end + 2 + raw.length] === ">" ||
              s[end + 2 + raw.length] === "/")
          )
            break;
          end++;
        }
      }
      if (end > start) {
        this.position = end;
        const data = replaceNulls(this.cut(start, start, end));
        return this.finish(start, {
          kind: "text",
          data: raw === "title" || raw === "textarea" ? decodeEntities(data, false) : data
        });
      }
    }
    if (s[start] !== "<") {
      end = s.indexOf("<", start);
      if (end < 0) end = s.length;
      this.position = end;
      return this.finish(start, {
        kind: "text",
        data: decodeEntities(replaceNulls(this.cut(start, start, end), foreign ? "\ufffd" : ""), false)
      });
    }
    if (foreign && s.startsWith("<![CDATA[", start)) {
      end = s.indexOf("]]>", start + 9);
      this.position = end < 0 ? s.length : end + 3;
      return this.finish(start, {
        kind: "text",
        data: replaceNulls(s.slice(start + 9, end < 0 ? s.length : end))
      });
    }
    if (s.startsWith("<!--", start)) {
      let p = start + 4;
      let data = "";
      let state: "start" | "startDash" | "data" | "dash" | "end" | "bang" = "start";
      while (p < s.length) {
        this.budget.charge("work", 1);
        this.budget.bound("tokenBytes", (p - start + 1) * 2);
        const c = s[p++]!;
        if (state === "start") {
          if (c === "-") state = "startDash";
          else if (c === ">") break;
          else {
            data += c === "\0" ? "\ufffd" : c;
            state = "data";
          }
        } else if (state === "startDash") {
          if (c === "-") state = "end";
          else if (c === ">") break;
          else {
            data += "-" + (c === "\0" ? "\ufffd" : c);
            state = "data";
          }
        } else if (state === "data") {
          if (c === "-") state = "dash";
          else data += c === "\0" ? "\ufffd" : c;
        } else if (state === "dash") {
          if (c === "-") state = "end";
          else {
            data += "-" + (c === "\0" ? "\ufffd" : c);
            state = "data";
          }
        } else if (state === "end") {
          if (c === ">") break;
          else if (c === "!") state = "bang";
          else if (c === "-") data += "-";
          else {
            data += "--" + (c === "\0" ? "\ufffd" : c);
            state = "data";
          }
        } else {
          if (c === ">") break;
          else if (c === "-") {
            data += "--!";
            state = "dash";
          } else {
            data += "--!" + (c === "\0" ? "\ufffd" : c);
            state = "data";
          }
        }
      }
      this.position = p;
      return this.finish(start, { kind: "comment", data });
    }
    if (asciiLower(this.look(start, start + 9)) === "<!doctype") {
      end = s.indexOf(">", start + 9);
      this.position = end < 0 ? s.length : end + 1;
      const value = this.cut(start, start + 9, end < 0 ? s.length : end).trim();
      let j = 0;
      while (j < value.length && !htmlSpace(value[j]!)) j++;
      return this.finish(start, { kind: "doctype", data: asciiLower(value.slice(0, j)) });
    }
    let p = start + 1;
    const closing = s[p] === "/";
    if (closing) p++;
    if (closing && p === s.length) {
      this.position = p;
      return this.finish(start, { kind: "text", data: "</" });
    }
    if (closing && s[p] === ">") {
      this.position = p + 1;
      return this.finish(start, { kind: "text", data: "" });
    }
    const code = s.charCodeAt(p);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) {
      if (s[p] === "!" || s[p] === "?" || closing) {
        end = s.indexOf(">", p);
        this.position = end < 0 ? s.length : end + 1;
        return this.finish(start, {
          kind: "comment",
          data: replaceNulls(this.cut(start, s[p] === "?" ? start + 1 : start + 2, end < 0 ? s.length : end))
        });
      }
      this.position = start + 1;
      return this.finish(start, { kind: "text", data: "<" });
    }
    const nameStart = p;
    while (p < s.length && !htmlSpace(s[p]!) && s[p] !== "/" && s[p] !== ">") p++;
    const name = asciiLower(replaceNulls(this.cut(start, nameStart, p)));
    const attributes: HtmlAttribute[] = [];
    let names: Set<string> | undefined;
    let selfClosing = false;
    let terminated = false;
    while (p < s.length) {
      while (htmlSpace(s[p] ?? "")) p++;
      if (s[p] === ">") {
        terminated = true;
        p++;
        break;
      }
      if (s[p] === "/" && s[p + 1] === ">") {
        selfClosing = true;
        terminated = true;
        p += 2;
        break;
      }
      if (s[p] === "/") {
        p++;
        continue;
      }
      const a = p;
      if (s[p] === "=") p++;
      while (p < s.length && !htmlSpace(s[p]!) && s[p] !== "=" && s[p] !== ">" && s[p] !== "/") p++;
      const attr = asciiLower(replaceNulls(this.cut(start, a, p)));
      while (htmlSpace(s[p] ?? "")) p++;
      let value = "";
      if (s[p] === "=") {
        p++;
        while (htmlSpace(s[p] ?? "")) p++;
        const quote = s[p];
        if (quote === '"' || quote === "'") {
          p++;
          const a = p;
          while (p < s.length && s[p] !== quote) p++;
          value = this.cut(start, a, p);
          if (p < s.length) p++;
        } else {
          const a = p;
          while (p < s.length && !htmlSpace(s[p]!) && s[p] !== ">") p++;
          value = this.cut(start, a, p);
        }
      }
      if (attr && !closing && !(names ? names.has(attr) : attributes.length === 1 && attributes[0]!.name === attr)) {
        this.budget.charge("attributes", 1);
        if (attributes.length >= 1) {
          if (!names) names = new Set([attributes[0]!.name, attr]);
          else names.add(attr);
        }
        attributes.push({
          name: attr,
          value: decodeEntities(replaceNulls(value), true),
          namespace: "none"
        });
      }
      if (p === a) p++;
    }
    this.position = p;
    if (!terminated) return undefined;
    return this.finish(start, { kind: closing ? "end" : "start", name, attributes, selfClosing });
  }
}
