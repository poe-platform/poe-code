import { createSandboxClosure } from "../values.js";
const mathMethods = {
    abs: Math.abs,
    acos: Math.acos,
    acosh: Math.acosh,
    asin: Math.asin,
    asinh: Math.asinh,
    atan: Math.atan,
    atan2: Math.atan2,
    atanh: Math.atanh,
    ceil: Math.ceil,
    cbrt: Math.cbrt,
    clz32: Math.clz32,
    cos: Math.cos,
    cosh: Math.cosh,
    exp: Math.exp,
    expm1: Math.expm1,
    floor: Math.floor,
    fround: Math.fround,
    hypot: Math.hypot,
    imul: Math.imul,
    log: Math.log,
    log1p: Math.log1p,
    log10: Math.log10,
    log2: Math.log2,
    max: Math.max,
    min: Math.min,
    pow: Math.pow,
    round: Math.round,
    sign: Math.sign,
    sin: Math.sin,
    sinh: Math.sinh,
    sqrt: Math.sqrt,
    tan: Math.tan,
    tanh: Math.tanh,
    trunc: Math.trunc
};
export function createMathGlobals(options = {}) {
    const random = options.random ?? Math.random;
    const mathObject = {
        E: Math.E,
        LN2: Math.LN2,
        LN10: Math.LN10,
        LOG2E: Math.LOG2E,
        LOG10E: Math.LOG10E,
        PI: Math.PI,
        SQRT1_2: Math.SQRT1_2,
        SQRT2: Math.SQRT2,
        random: createSandboxClosure({
            call: () => random(),
            name: "random"
        })
    };
    for (const [name, method] of Object.entries(mathMethods)) {
        mathObject[name] = createSandboxClosure({
            call: (args) => Reflect.apply(method, Math, args),
            name
        });
    }
    return {
        Infinity,
        Math: mathObject,
        NaN: Number.NaN
    };
}
export function createSeededRandom(seed) {
    let state = normalizeSeed(seed);
    return {
        next: () => {
            state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
            return state / 4_294_967_296;
        },
        snapshot: () => state,
        restore: (nextState) => {
            state = normalizeSeed(nextState);
        }
    };
}
function normalizeSeed(seed) {
    if (!Number.isFinite(seed)) {
        throw new TypeError("Seeded random requires a finite numeric seed.");
    }
    return Math.trunc(seed) >>> 0;
}
