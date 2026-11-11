import type { ImageInputReader } from "./image-input.js";
import { drainCooperativeSteps, yieldTurn } from "safe-bash-contracts/yield";

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

export async function readImageInputNames(path: string, read: ImageInputReader, signal: AbortSignal): Promise<string[]> {
    if (!path.startsWith("@")) return [path];
    return await read(path.slice(1), async source => {
        const bytes = new Uint8Array(source.size);
        for (let offset = 0; offset < source.size; offset += 16384) {
            await yieldTurn(signal);
            bytes.set(await source.read(offset, Math.min(16384, source.size - offset), { signal }), offset);
        }
        return drainCooperativeSteps(montageInputNames(bytes), signal);
    }) ?? [path];
}
