import { getSandboxIterator } from "../iteration.js";
import { allocateProducedSandboxValue, createSandboxClosure } from "../values.js";
const generatorMethodNames = new Set(["next", "return", "throw"]);
export function getGeneratorMember(target, property, budget) {
    if (typeof property !== "string" || !generatorMethodNames.has(property)) {
        return undefined;
    }
    return createSandboxClosure({
        name: property,
        call: async ([value]) => {
            const iterator = getSandboxIterator(target);
            const result = await iterator[property](value);
            return allocateProducedSandboxValue({ value: result.value, done: result.done === true }, budget);
        }
    });
}
