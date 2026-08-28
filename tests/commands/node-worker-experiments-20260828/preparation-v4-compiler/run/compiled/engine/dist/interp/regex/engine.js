import { allocateRegexSteps } from "../budget.js";
export function matchRegex(pattern, input, lastIndex = 0) {
    const startIndex = pattern.flags.global ? normalizeLastIndex(lastIndex) : 0;
    return matchRegexFrom(pattern, input, startIndex);
}
export function matchRegexFrom(pattern, input, startIndex) {
    if (startIndex > input.length) {
        return null;
    }
    for (let attempt = startIndex; attempt <= input.length; attempt += 1) {
        const context = { input, flags: pattern.flags, steps: 0 };
        charge(context);
        const initialState = {
            position: attempt,
            captures: new Array(pattern.captureCount)
        };
        const result = matchNode(pattern.body, initialState, context).next();
        if (!result.done) {
            return toRegexMatch(input, attempt, result.value);
        }
    }
    return null;
}
function* matchNode(node, state, context) {
    charge(context);
    switch (node.type) {
        case "empty":
            yield state;
            return;
        case "literal":
            if (charactersEqual(context.input[state.position], node.value, context.flags.ignoreCase)) {
                yield { ...state, position: state.position + 1 };
            }
            return;
        case "dot":
            if (state.position < context.input.length &&
                (context.flags.dotAll || !isLineTerminator(context.input[state.position]))) {
                yield { ...state, position: state.position + 1 };
            }
            return;
        case "anchor":
            if (matchesAnchor(node.kind, state.position, context)) {
                yield state;
            }
            return;
        case "wordBoundary": {
            const previousWord = state.position > 0 && isWordCharacter(context.input[state.position - 1]);
            const nextWord = state.position < context.input.length && isWordCharacter(context.input[state.position]);
            if ((previousWord !== nextWord) !== node.negated) {
                yield state;
            }
            return;
        }
        case "characterClass": {
            const character = context.input[state.position];
            if (character !== undefined &&
                matchesCharacterClass(character, node.items, node.negated, context.flags.ignoreCase)) {
                yield { ...state, position: state.position + 1 };
            }
            return;
        }
        case "sequence":
            yield* matchSequence(node.elements, 0, state, context);
            return;
        case "alternation":
            for (const alternative of node.alternatives) {
                yield* matchNode(alternative, cloneState(state), context);
            }
            return;
        case "group":
            for (const result of matchNode(node.body, cloneState(state), context)) {
                if (!node.capturing || node.index === undefined) {
                    yield result;
                    continue;
                }
                const captures = result.captures.slice();
                captures[node.index - 1] = { start: state.position, end: result.position };
                yield { position: result.position, captures };
            }
            return;
        case "quantifier":
            yield* matchQuantifier(node, state, context, 0);
    }
}
function* matchSequence(elements, index, state, context) {
    charge(context);
    if (index === elements.length) {
        yield state;
        return;
    }
    for (const result of matchNode(elements[index], state, context)) {
        yield* matchSequence(elements, index + 1, result, context);
    }
}
function* matchQuantifier(node, state, context, count) {
    charge(context);
    const canRepeat = node.max === undefined || count < node.max;
    if (!node.greedy && count >= node.min) {
        yield state;
    }
    if (canRepeat) {
        for (const result of matchNode(node.body, clearCaptures(node.body, state), context)) {
            if (result.position === state.position) {
                if (count >= node.min) {
                    continue;
                }
                if (count + 1 >= node.min) {
                    yield result;
                }
                else {
                    yield* matchQuantifier(node, result, context, count + 1);
                }
                continue;
            }
            yield* matchQuantifier(node, result, context, count + 1);
        }
    }
    if (node.greedy && count >= node.min) {
        yield state;
    }
}
function matchesAnchor(kind, position, context) {
    if (kind === "start") {
        return (position === 0 ||
            (context.flags.multiline && position > 0 && isLineTerminator(context.input[position - 1])));
    }
    return (position === context.input.length ||
        (context.flags.multiline &&
            position < context.input.length &&
            isLineTerminator(context.input[position])));
}
function matchesCharacterClass(character, items, negated, ignoreCase) {
    const matched = items.some((item) => matchesCharacterClassItem(character, item, ignoreCase));
    return negated ? !matched : matched;
}
function matchesCharacterClassItem(character, item, ignoreCase) {
    if (item.type === "character") {
        return charactersEqual(character, item.value, ignoreCase);
    }
    if (item.type === "range") {
        const candidate = character.charCodeAt(0);
        const from = item.from.charCodeAt(0);
        const to = item.to.charCodeAt(0);
        if (candidate >= from && candidate <= to) {
            return true;
        }
        if (!ignoreCase) {
            return false;
        }
        const foldedCandidate = foldCharacter(character, true).charCodeAt(0);
        const foldedFrom = foldCharacter(item.from, true).charCodeAt(0);
        const foldedTo = foldCharacter(item.to, true).charCodeAt(0);
        return foldedCandidate >= foldedFrom && foldedCandidate <= foldedTo;
    }
    const matched = item.kind === "digit"
        ? isDigit(character)
        : item.kind === "word"
            ? isWordCharacter(character)
            : isSpaceCharacter(character);
    return item.negated ? !matched : matched;
}
function toRegexMatch(input, start, state) {
    return {
        index: start,
        text: input.slice(start, state.position),
        captures: state.captures.map((capture) => capture === undefined ? undefined : input.slice(capture.start, capture.end))
    };
}
function cloneState(state) {
    return { position: state.position, captures: state.captures.slice() };
}
function clearCaptures(node, state) {
    const captures = state.captures.slice();
    clearNodeCaptures(node, captures);
    return { position: state.position, captures };
}
function clearNodeCaptures(node, captures) {
    if (node.type === "group") {
        if (node.capturing && node.index !== undefined) {
            captures[node.index - 1] = undefined;
        }
        clearNodeCaptures(node.body, captures);
        return;
    }
    if (node.type === "sequence") {
        for (const element of node.elements) {
            clearNodeCaptures(element, captures);
        }
        return;
    }
    if (node.type === "alternation") {
        for (const alternative of node.alternatives) {
            clearNodeCaptures(alternative, captures);
        }
        return;
    }
    if (node.type === "quantifier") {
        clearNodeCaptures(node.body, captures);
    }
}
function charge(context) {
    context.steps += 1;
    allocateRegexSteps(context.steps);
}
function normalizeLastIndex(lastIndex) {
    if (!Number.isFinite(lastIndex) || lastIndex <= 0) {
        return 0;
    }
    return Math.floor(lastIndex);
}
function charactersEqual(left, right, ignoreCase) {
    return left !== undefined && foldCharacter(left, ignoreCase) === foldCharacter(right, ignoreCase);
}
function foldCharacter(character, ignoreCase) {
    if (!ignoreCase) {
        return character;
    }
    const folded = character.toUpperCase();
    if (folded.length !== 1) {
        return character;
    }
    if (character.charCodeAt(0) >= 0x80 && folded.charCodeAt(0) < 0x80) {
        return character;
    }
    return folded;
}
function isDigit(character) {
    return character >= "0" && character <= "9";
}
function isWordCharacter(character) {
    return (isDigit(character) ||
        (character >= "A" && character <= "Z") ||
        (character >= "a" && character <= "z") ||
        character === "_");
}
function isSpaceCharacter(character) {
    return (character === " " ||
        character === "\f" ||
        character === "\n" ||
        character === "\r" ||
        character === "\t" ||
        character === "\v" ||
        character === "\u00a0" ||
        character === "\u1680" ||
        (character >= "\u2000" && character <= "\u200a") ||
        character === "\u2028" ||
        character === "\u2029" ||
        character === "\u202f" ||
        character === "\u205f" ||
        character === "\u3000" ||
        character === "\ufeff");
}
function isLineTerminator(character) {
    return (character === "\n" || character === "\r" || character === "\u2028" || character === "\u2029");
}
