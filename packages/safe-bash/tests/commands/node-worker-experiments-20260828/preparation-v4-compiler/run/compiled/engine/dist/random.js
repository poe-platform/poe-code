import { randomInt } from "node:crypto";
import { createSeededRandom } from "./interp/globals/math.js";
export function createReplayableRandom(options = {}) {
    const snapshot = options.snapshot;
    const saved = snapshot?.random;
    let initialState = options.seed;
    if (saved !== undefined) {
        const hasLoopState = typeof snapshot?.loopIterations === "object" &&
            snapshot.loopIterations !== null &&
            Object.keys(snapshot.loopIterations).length > 0;
        const replaysFromStart = snapshot?.replay !== undefined ||
            (Array.isArray(snapshot?.pendingAwaits) &&
                snapshot.pendingAwaits.length > 0 &&
                !hasLoopState);
        initialState = replaysFromStart
            ? (saved.initialState ?? saved.seed)
            : (saved.resumeState ?? saved.state);
    }
    const generator = createSeededRandom(initialState ?? randomInt(4_294_967_296));
    return { seed: saved?.seed ?? generator.snapshot(), ...generator };
}
