import { Builder, type Budget } from "./budget.js";

const named: Readonly<Record<string, string>> = Object.freeze({
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
  copy: "©", reg: "®", trade: "™", hellip: "…", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·",
  euro: "€", pound: "£", yen: "¥", cent: "¢", times: "×", divide: "÷",
  colon: ":", Tab: "\t", NewLine: "\n",
});

export function entities(text: string, budget: Budget): string {
  budget.work(text.length);
  return text.replace(/&(#(?:[xX][0-9a-fA-F]{1,8}|[0-9]{1,10})|[A-Za-z][A-Za-z0-9]{0,31});/gu, (whole: string, name: string) => {
    if (name[0] !== "#") return Object.hasOwn(named, name) ? named[name]! : whole;
    const hexadecimal = name[1]?.toLowerCase() === "x";
    const value = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return value === 0 || value > 0x10ffff || value >= 0xd800 && value <= 0xdfff ? "�" : String.fromCodePoint(value);
  });
}

export function escapeText(text: string, budget: Budget, maximum?: number): string {
  const result = new Builder(budget, maximum);
  for (const character of text) {
    budget.work(1);
    const scalar = character.codePointAt(0)!;
    if (scalar < 32 && character !== "\n" && character !== "\t" && character !== "\r" || scalar >= 0x7f && scalar <= 0x9f) result.append("�");
    else result.append("\\`*_{}[]<>!|#+-&".includes(character) ? "\\" + character : character);
  }
  return result.finish();
}

export function destination(value: string | undefined, image: boolean, budget: Budget): string | undefined {
  if (value === undefined) return undefined;
  budget.work(value.length);
  const text = value.trim();
  if (!text || /[\u0000-\u0020\u007f-\u009f\\]/u.test(text.replaceAll(" ", ""))
    || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(text) || /&(?:#[^;\s]+|[A-Za-z][A-Za-z0-9]*);/u.test(text)
    || text.startsWith("//")) return undefined;
  const prefix = text.split(/[/?#]/u, 1)[0]!;
  if (prefix.includes(":")) {
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(text)?.[1]?.toLowerCase();
    if (scheme !== "http" && scheme !== "https" && (image || scheme !== "mailto")) return undefined;
    if (scheme !== "mailto") {
      try { const parsed = new URL(text); if (!parsed.hostname || !/^https?:\/\//iu.test(text)) return undefined; }
      catch { return undefined; }
    }
  }
  const result = new Builder(budget);
  for (const character of text) {
    budget.work(1);
    result.append(/[ <>"'`()\[\]{}|]/u.test(character) ? encodeURIComponent(character).replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29") : character);
  }
  return result.finish();
}
