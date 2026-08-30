import { define, integer, options, output, requireOperands } from "../../internal.js";
import { sources, validatedOption } from "./shared.js";
const alphabets = {
    base64: { symbols: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", bits: 6, quantum: 4, lengths: [2, 3, 4] },
    base32: { symbols: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", bits: 5, quantum: 8, lengths: [2, 4, 5, 7, 8] },
};
async function encode(context, files, alphabet, wrap) {
    let carry = 0;
    let bits = 0;
    let symbols = 0;
    let column = 0;
    let pending = "";
    const emit = (character) => {
        pending += character;
        symbols = (symbols + 1) % alphabet.quantum;
        if (wrap && ++column === wrap) {
            pending += "\n";
            column = 0;
        }
    };
    for await (const chunk of sources(context, files)) {
        for (const byte of chunk) {
            carry = (carry << 8) | byte;
            bits += 8;
            while (bits >= alphabet.bits) {
                bits -= alphabet.bits;
                emit(alphabet.symbols[(carry >> bits) & ((1 << alphabet.bits) - 1)]);
            }
            carry &= (1 << bits) - 1;
        }
        if (pending) {
            await output(context, pending);
            pending = "";
        }
    }
    if (bits)
        emit(alphabet.symbols[carry << (alphabet.bits - bits)]);
    while (symbols)
        emit("=");
    if (wrap && column)
        pending += "\n";
    if (pending)
        await output(context, pending);
}
function decodeQuantum(quantum, alphabet) {
    const decoded = [];
    if (alphabet.bits === 5 && quantum.length < alphabet.quantum)
        return { bytes: decoded, valid: false };
    let carry = 0;
    let bits = 0;
    let length = 0;
    while (length < quantum.length && quantum[length] >= 0) {
        carry = (carry << alphabet.bits) | quantum[length++];
        bits += alphabet.bits;
        if (bits >= 8) {
            bits -= 8;
            decoded.push((carry >> bits) & 255);
        }
        carry &= (1 << bits) - 1;
    }
    return { bytes: decoded, valid: quantum.length === alphabet.quantum && alphabet.lengths.includes(length)
            && quantum.slice(length).every(number => number === -1) && carry === 0 };
}
async function decode(context, files, alphabet, ignore) {
    const lookup = new Int16Array(256).fill(-2);
    for (let index = 0; index < alphabet.symbols.length; index++)
        lookup[alphabet.symbols.charCodeAt(index)] = index;
    lookup[61] = -1;
    let quantum = [];
    let lastByte;
    for await (const chunk of sources(context, files)) {
        const pending = [];
        let invalid = false;
        for (const byte of chunk) {
            const symbol = lookup[byte];
            if (ignore && symbol === -2)
                continue;
            lastByte = byte;
            if (byte === 10)
                continue;
            quantum.push(symbol);
            if (quantum.length === alphabet.quantum) {
                const decoded = decodeQuantum(quantum, alphabet);
                pending.push(...decoded.bytes);
                if (!decoded.valid) {
                    invalid = true;
                    break;
                }
                quantum = [];
            }
        }
        if (pending.length)
            await output(context, Uint8Array.from(pending));
        if (invalid)
            throw new Error("invalid input");
    }
    if (quantum.length) {
        if (lastByte !== 61)
            while (quantum.length < alphabet.quantum)
                quantum.push(-1);
        const decoded = decodeQuantum(quantum, alphabet);
        if (decoded.bytes.length)
            await output(context, Uint8Array.from(decoded.bytes));
        if (!decoded.valid)
            throw new Error("invalid input");
    }
}
export function createBaseCommand(name) {
    return define(name, async (context) => {
        const parsed = options(context.args, "diw:", { decode: "d", "ignore-garbage": "i", wrap: "w" });
        requireOperands(parsed.operands, 0, 1);
        const wrap = validatedOption(parsed, "w", integer, 76);
        if (parsed.flags.has("d"))
            await decode(context, parsed.operands, alphabets[name], parsed.flags.has("i"));
        else
            await encode(context, parsed.operands, alphabets[name], wrap);
        return { exitCode: 0 };
    });
}
//# sourceMappingURL=base.js.map