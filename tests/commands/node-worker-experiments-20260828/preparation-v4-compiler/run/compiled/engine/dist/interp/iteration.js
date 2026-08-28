import { isSandboxGenerator, isSandboxMap, isSandboxSet } from "./values.js";
import { enterRunningState } from "./running-state.js";
export function getSandboxIterator(value) {
    if (isSandboxGenerator(value)) {
        return generatorIterator(value);
    }
    if (typeof value === "string") {
        return syncIterator(value[Symbol.iterator]());
    }
    if (isSandboxMap(value)) {
        return syncIterator(Array.from(value.entries, ([key, entry]) => [key, entry])[Symbol.iterator]());
    }
    if (isSandboxSet(value)) {
        return syncIterator(value.values[Symbol.iterator]());
    }
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
        return undefined;
    }
    const iteratorMethod = value[Symbol.iterator];
    if (typeof iteratorMethod !== "function") {
        return undefined;
    }
    return syncIterator(Reflect.apply(iteratorMethod, value, []));
}
function generatorIterator(generator) {
    const invoke = async (method, value) => {
        const leaveRunning = enterRunningState(generator);
        generator.state = "running";
        try {
            const result = (await generator.channel[method](value));
            generator.state = result.done ? "done" : "suspended";
            return result;
        }
        catch (error) {
            generator.state = "done";
            throw error;
        }
        finally {
            leaveRunning();
        }
    };
    return {
        generator: true,
        next: (value) => invoke("next", value),
        return: (value) => invoke("return", value),
        throw: (error) => invoke("throw", error)
    };
}
function syncIterator(iterator) {
    const invoke = async (method, value) => {
        const leaveRunning = enterRunningState(iterator);
        try {
            return await iterator[method](value);
        }
        finally {
            leaveRunning();
        }
    };
    return {
        next: (value) => invoke("next", value),
        ...(typeof iterator.return === "function"
            ? { return: (value) => invoke("return", value) }
            : {}),
        ...(typeof iterator.throw === "function"
            ? { throw: (error) => invoke("throw", error) }
            : {})
    };
}
