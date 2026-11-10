export function* montageInputNames(bytes: Uint8Array): Generator<void, string[], void> {
    const names: string[] = [];
    const text = new TextDecoder().decode(bytes);
    let name = "", quote = "";
    for (let position = 0; position < text.length; position++) {
        if (position % 64 === 0) yield;
        const char = text[position]!;
        if (quote) {
            if (char === quote) quote = "";
            else name += char;
        }
        else if (char === '"' || char === "'") quote = char;
        else if (char.trim() === "") {
            if (name) names.push(name);
            name = "";
        }
        else name += char;
    }
    if (name) names.push(name);
    return names;
}
