import { Budget, ExprError, nextCharacter, requireByteCollation, utf8Profile } from "./internal.js";
export function smallInteger(value, budget) {
    const text = String(value);
    budget.check(text.length, budget.limits.maxNumericDigits, "numeric result digits");
    budget.charge(text.length);
    return { number: BigInt(value), text };
}
export const zeroValue = { number: 0n, text: "0" };
export function bytes(value, budget) {
    return value instanceof Uint8Array ? value : budget.encode(value.text);
}
export function truth(value, budget) {
    if (!(value instanceof Uint8Array))
        return value.number !== 0n;
    budget.charge(value.length);
    if (!value.length)
        return false;
    const start = value[0] === 45 ? 1 : 0;
    if (start === value.length)
        return true;
    for (let offset = start; offset < value.length; offset++)
        if (value[offset] !== 48)
            return true;
    return false;
}
function numericShape(value, budget) {
    if (!(value instanceof Uint8Array))
        return true;
    budget.charge(value.length);
    const start = value[0] === 45 ? 1 : 0;
    if (start === value.length)
        return false;
    for (let offset = start; offset < value.length; offset++) {
        if (value[offset] < 48 || value[offset] > 57)
            return false;
    }
    return true;
}
function numeric(value, budget) {
    if (!(value instanceof Uint8Array))
        return value.number;
    if (!numericShape(value, budget))
        return undefined;
    const start = value[0] === 45 ? 1 : 0;
    budget.check(value.length - start, budget.limits.maxNumericDigits, "numeric digits");
    budget.charge(value.length * value.length);
    budget.allocation(value.length);
    return BigInt(new TextDecoder().decode(value));
}
function integer(value, budget) {
    const result = numeric(value, budget);
    if (result === undefined)
        throw new ExprError("non-integer argument");
    return result;
}
function arithmetic(operator, left, right, budget) {
    const first = integer(left, budget), second = integer(right, budget);
    if ((operator === "/" || operator === "%") && second === 0n)
        throw new ExprError("division by zero");
    const firstDigits = left instanceof Uint8Array ? left.length : left.text.length;
    const secondDigits = right instanceof Uint8Array ? right.length : right.text.length;
    const upper = operator === "*" ? firstDigits + secondDigits : Math.max(firstDigits, secondDigits) + 1;
    budget.allocation(upper + 1);
    budget.charge(firstDigits * secondDigits);
    const result = operator === "+" ? first + second : operator === "-" ? first - second
        : operator === "*" ? first * second : operator === "/" ? first / second : first % second;
    const resultText = result.toString();
    budget.check(resultText.length - (result < 0n ? 1 : 0), budget.limits.maxNumericDigits, "arithmetic result digits");
    return { number: result, text: resultText };
}
function compare(left, right, budget) {
    if (numericShape(left, budget) && numericShape(right, budget)) {
        const first = integer(left, budget), second = integer(right, budget);
        return first < second ? -1 : first > second ? 1 : 0;
    }
    requireByteCollation(budget.context);
    const firstBytes = bytes(left, budget), secondBytes = bytes(right, budget);
    budget.charge(Math.min(firstBytes.length, secondBytes.length));
    for (let offset = 0; offset < Math.min(firstBytes.length, secondBytes.length); offset++) {
        if (firstBytes[offset] !== secondBytes[offset])
            return firstBytes[offset] - secondBytes[offset];
    }
    return firstBytes.length - secondBytes.length;
}
export function characterCount(value, budget, unicode) {
    budget.charge(value.length);
    if (!unicode)
        return value.length;
    let count = 0;
    for (let offset = 0; offset < value.length; offset = nextCharacter(value, offset, true))
        count++;
    return count;
}
export async function evaluateCall(operator, values, budget, match) {
    const subject = bytes(values[0], budget);
    const unicode = utf8Profile(budget.context);
    if (operator === "match")
        return match(subject, bytes(values[1], budget), unicode);
    if (operator === "length")
        return smallInteger(characterCount(subject, budget, unicode), budget);
    if (operator === "index") {
        const accept = bytes(values[1], budget);
        let position = 0;
        for (let offset = 0; offset < subject.length;) {
            const end = nextCharacter(subject, offset, unicode);
            position++;
            for (let candidate = 0; candidate < accept.length;) {
                const candidateEnd = nextCharacter(accept, candidate, unicode);
                budget.charge(1 + end - offset);
                if (end - offset === candidateEnd - candidate) {
                    let equal = true;
                    for (let byte = 0; byte < end - offset; byte++)
                        if (subject[offset + byte] !== accept[candidate + byte])
                            equal = false;
                    if (equal)
                        return smallInteger(position, budget);
                }
                candidate = candidateEnd;
                await budget.yield();
            }
            offset = end;
            await budget.yield();
        }
        return zeroValue;
    }
    const position = numeric(values[1], budget), length = numeric(values[2], budget);
    if (position === undefined || length === undefined || position <= 0n || length <= 0n || position > BigInt(subject.length))
        return new Uint8Array();
    const startIndex = Number(position - 1n), wanted = Number(length > BigInt(subject.length) ? BigInt(subject.length) : length);
    let start = 0, end = 0, index = 0;
    budget.charge(subject.length);
    while (start < subject.length && index++ < startIndex)
        start = nextCharacter(subject, start, unicode);
    end = start;
    for (let count = 0; count < wanted && end < subject.length; count++)
        end = nextCharacter(subject, end, unicode);
    budget.allocation(end - start);
    return new Uint8Array(subject.subarray(start, end));
}
export async function evaluateBinary(operator, left, right, budget, match) {
    if (["<", "<=", "=", "==", "!=", ">=", ">"].includes(operator)) {
        const order = compare(left, right, budget);
        return smallInteger(Number(operator === "<" ? order < 0 : operator === "<=" ? order <= 0
            : operator === ">" ? order > 0 : operator === ">=" ? order >= 0 : operator === "!=" ? order !== 0 : order === 0), budget);
    }
    if (operator === ":")
        return match(bytes(left, budget), bytes(right, budget), utf8Profile(budget.context));
    return arithmetic(operator, left, right, budget);
}
//# sourceMappingURL=evaluate.js.map