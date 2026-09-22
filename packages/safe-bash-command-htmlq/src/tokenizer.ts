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
export class HtmlTokenizer {
  private position = 0;
  constructor(
    private readonly source: string,
    private readonly budget: HtmlBudget
  ) {
    this.budget.charge("work", source.length * 2);
  }
  next(raw?: string, foreign = false): HtmlToken | undefined {
    const s = this.source;
    const start = this.position;
    if (start >= s.length) return undefined;
    this.budget.check();
    let end = start;
    const cut = (from: number, to = s.length): string => {
      const end = Math.min(s.length, to);
      this.budget.bound("tokenBytes", Math.max(0, end - start) * 2);
      this.budget.charge("work", Math.max(0, end - from) * 33);
      return this.source.slice(from, end);
    };
    const look = (from: number, to: number): string => {
      this.budget.charge("work", Math.min(s.length, to) - from);
      return this.source.slice(from, to);
    };
    const finish = (token: HtmlToken): HtmlToken => {
      this.budget.bound("tokenBytes", (this.position - start) * 2);
      this.budget.charge("work", this.position - start + 1);
      return token;
    };
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
              asciiLower(look(end, end + 7)) === "<script" &&
              (htmlSpace(s[end + 7] ?? "") || s[end + 7] === "/" || s[end + 7] === ">");
            const closing =
              asciiLower(look(end, end + 8)) === "</script" &&
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
            asciiLower(look(end + 2, end + 2 + raw.length)) === raw &&
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
        const data = cut(start, end).split("\0").join("�");
        return finish({
          kind: "text",
          data: raw === "title" || raw === "textarea" ? decodeEntities(data, false) : data
        });
      }
    }
    if (s[start] !== "<") {
      end = s.indexOf("<", start);
      if (end < 0) end = s.length;
      this.position = end;
      return finish({
        kind: "text",
        data: decodeEntities(cut(start, end).split("\0").join(foreign ? "�" : ""), false)
      });
    }
    if (foreign && s.startsWith("<![CDATA[", start)) {
      end = s.indexOf("]]>", start + 9);
      this.position = end < 0 ? s.length : end + 3;
      return finish({
        kind: "text",
        data: s
          .slice(start + 9, end < 0 ? s.length : end)
          .split("\0")
          .join("�")
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
            data += c === "\0" ? "�" : c;
            state = "data";
          }
        } else if (state === "startDash") {
          if (c === "-") state = "end";
          else if (c === ">") break;
          else {
            data += "-" + (c === "\0" ? "�" : c);
            state = "data";
          }
        } else if (state === "data") {
          if (c === "-") state = "dash";
          else data += c === "\0" ? "�" : c;
        } else if (state === "dash") {
          if (c === "-") state = "end";
          else {
            data += "-" + (c === "\0" ? "�" : c);
            state = "data";
          }
        } else if (state === "end") {
          if (c === ">") break;
          else if (c === "!") state = "bang";
          else if (c === "-") data += "-";
          else {
            data += "--" + (c === "\0" ? "�" : c);
            state = "data";
          }
        } else {
          if (c === ">") break;
          else if (c === "-") {
            data += "--!";
            state = "dash";
          } else {
            data += "--!" + (c === "\0" ? "�" : c);
            state = "data";
          }
        }
      }
      this.position = p;
      return finish({ kind: "comment", data });
    }
    if (asciiLower(look(start, start + 9)) === "<!doctype") {
      end = s.indexOf(">", start + 9);
      this.position = end < 0 ? s.length : end + 1;
      const value = cut(start + 9, end < 0 ? s.length : end).trim();
      let j = 0;
      while (j < value.length && !htmlSpace(value[j]!)) j++;
      return finish({ kind: "doctype", data: asciiLower(value.slice(0, j)) });
    }
    let p = start + 1;
    const closing = s[p] === "/";
    if (closing) p++;
    if (closing && p === s.length) {
      this.position = p;
      return finish({ kind: "text", data: "</" });
    }
    if (closing && s[p] === ">") {
      this.position = p + 1;
      return finish({ kind: "text", data: "" });
    }
    const code = s.charCodeAt(p);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) {
      if (s[p] === "!" || s[p] === "?" || closing) {
        end = s.indexOf(">", p);
        this.position = end < 0 ? s.length : end + 1;
        return finish({
          kind: "comment",
          data: cut(s[p] === "?" ? start + 1 : start + 2, end < 0 ? s.length : end)
            .split("\0")
            .join("�")
        });
      }
      this.position = start + 1;
      return finish({ kind: "text", data: "<" });
    }
    const nameStart = p;
    while (p < s.length && !htmlSpace(s[p]!) && s[p] !== "/" && s[p] !== ">") p++;
    const name = asciiLower(cut(nameStart, p).split("\0").join("�"));
    const attributes: HtmlAttribute[] = [];
    const names = new Set<string>();
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
      const attr = asciiLower(cut(a, p).split("\0").join("�"));
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
          value = cut(a, p);
          if (p < s.length) p++;
        } else {
          const a = p;
          while (p < s.length && !htmlSpace(s[p]!) && s[p] !== ">") p++;
          value = cut(a, p);
        }
      }
      if (attr && !closing && !names.has(attr)) {
        this.budget.charge("attributes", 1);
        names.add(attr);
        attributes.push({
          name: attr,
          value: decodeEntities(value.split("\0").join("�"), true),
          namespace: "none"
        });
      }
      if (p === a) p++;
    }
    this.position = p;
    if (!terminated) return undefined;
    return finish({ kind: closing ? "end" : "start", name, attributes, selfClosing });
  }
}
