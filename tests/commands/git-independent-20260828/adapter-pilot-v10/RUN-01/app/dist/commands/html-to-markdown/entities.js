import { Builder } from "./budget.js";
import { htmlSpace } from "./text.js";
const named = Object.freeze({
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
    copy: "©", reg: "®", trade: "™", hellip: "…", ndash: "–", mdash: "—",
    lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·",
    euro: "€", pound: "£", yen: "¥", cent: "¢", times: "×", divide: "÷",
    colon: ":", Tab: "\t", NewLine: "\n",
});
export async function entities(text, budget) {
    const result = new Builder(budget);
    for (let offset = 0; offset < text.length;) {
        budget.work(1);
        const candidateSize = text[offset] === "&" ? Math.min(34, text.length - offset) : 0;
        budget.work(candidateSize);
        const candidate = text.slice(offset, offset + candidateSize);
        const match = candidate && /^&(#(?:[xX][0-9a-fA-F]{1,8}|[0-9]{1,10})|[A-Za-z][A-Za-z0-9]{0,31});/u.exec(candidate);
        if (match) {
            const name = match[1];
            if (name[0] !== "#")
                result.append(Object.hasOwn(named, name) ? named[name] : match[0]);
            else {
                const hexadecimal = name[1]?.toLowerCase() === "x";
                const value = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
                result.append(value === 0 || value > 0x10ffff || value >= 0xd800 && value <= 0xdfff ? "�" : String.fromCodePoint(value));
            }
            offset += match[0].length;
        }
        else {
            const character = String.fromCodePoint(text.codePointAt(offset));
            result.append(character);
            offset += character.length;
        }
        await budget.checkpoint();
    }
    return result.finish();
}
export async function escapeText(text, budget, maximum, edges = [false, false], precedingDigit = false) {
    const result = new Builder(budget, maximum);
    let offset = 0;
    for (const character of text) {
        budget.work(1);
        const scalar = character.codePointAt(0);
        if (scalar < 32 && character !== "\n" && character !== "\t" && character !== "\r" || scalar >= 0x7f && scalar <= 0x9f)
            result.append("�");
        else if ((edges[0] && offset === 0 || edges[1] && offset + character.length === text.length) && !htmlSpace(character))
            result.append(`&#${scalar};`);
        else
            result.append("\\`*_{}[]<>!|#+-&~=".includes(character) || ".)".includes(character) && (offset === 0 ? precedingDigit : /[0-9]/u.test(text[offset - 1])) ? "\\" + character : character);
        offset += character.length;
        await budget.checkpoint();
    }
    return result.finish();
}
export async function destination(value, image, budget) {
    if (value === undefined)
        return undefined;
    let first = 0, last = value.length, reference = "none";
    for (let offset = 0; offset < value.length; offset++) {
        budget.work(1);
        const code = value.charCodeAt(offset), character = value[offset];
        if (code < 32 || code >= 0x7f && code <= 0x9f || character === "\\")
            return undefined;
        if (character === "%" && /^(?:0[0-9a-f]|1[0-9a-f]|7f)$/iu.test(value.slice(offset + 1, offset + 3)))
            return undefined;
        if (character === ";" && (reference === "numeric" || reference === "named"))
            return undefined;
        if (reference === "numeric") {
            if (/\s/u.test(character))
                reference = "none";
        }
        else if (reference === "start" && character === "#")
            reference = "numeric";
        else if (reference === "start" && /[A-Za-z]/u.test(character))
            reference = "named";
        else if (reference === "named" && /[A-Za-z0-9]/u.test(character)) { }
        else
            reference = character === "&" ? "start" : "none";
        await budget.checkpoint();
    }
    while (first < last && value[first] === " ") {
        budget.work(1);
        first++;
        await budget.checkpoint();
    }
    while (last > first && value[last - 1] === " ") {
        budget.work(1);
        last--;
        await budget.checkpoint();
    }
    budget.work(last - first);
    const text = value.slice(first, last);
    if (!text || text.startsWith("//"))
        return undefined;
    let boundary = 0;
    while (boundary < text.length && !"/?#".includes(text[boundary])) {
        budget.work(1);
        boundary++;
        await budget.checkpoint();
    }
    budget.work(boundary);
    const prefix = text.slice(0, boundary);
    if (prefix.includes(":")) {
        const scheme = prefix.slice(0, prefix.indexOf(":")).toLowerCase();
        if (scheme !== "http" && scheme !== "https" && (image || scheme !== "mailto"))
            return undefined;
        if (scheme !== "mailto") {
            budget.work(text.length);
            try {
                const parsed = new URL(text);
                if (!parsed.hostname || !/^https?:\/\//iu.test(text))
                    return undefined;
            }
            catch {
                return undefined;
            }
        }
    }
    const result = new Builder(budget);
    for (const character of text) {
        budget.work(1);
        result.append(/[ <>"'`()\[\]{}|]/u.test(character) ? encodeURIComponent(character).replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29") : character);
        await budget.checkpoint();
    }
    return result.finish();
}
//# sourceMappingURL=entities.js.map