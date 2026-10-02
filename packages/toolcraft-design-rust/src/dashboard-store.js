import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {limitOutputPreview} from "./output-preview.js";

const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");

export function createStore() {
  let state;
  const listeners = new Set();
  const invoke = createComponentPolicy(native.designDashboardStorePolicy, {
    initialize: (status, zero) => ({output: [], stats: {status, iterations: zero, tokensIn: zero, tokensOut: zero, elapsedMs: zero}}),
    preview: limitOutputPreview,
    same: (a, b) => a === b,
    gte: (a, b) => a >= b,
    retained: (item, text, detail) => ({...item, text, detail}),
    find: item => state.output.findIndex(entry => invoke("matchId", [entry, item])),
    replace: (existing, retained) => state.output.map((entry, index) => index === existing ? retained : entry),
    outputLength: () => state.output.length,
    trimAppend: (retained, limit) => [...state.output.slice(state.output.length - limit + 1), retained],
    append: retained => [...state.output, retained],
    updatedOutput: output => ({...state, output}),
    cloneState: () => ({...state}),
    stats: () => state.stats,
    merge: (a, b) => ({...a, ...b}),
    updatedStats: (next, stats) => ({...next, stats}),
    commit(next) {
      state = next;
      for (const listener of listeners) listener();
    },
    invalidOperation() { throw new TypeError("Invalid dashboard store operation"); }
  });
  state = invoke("initialize", []);
  function getState() { return state; }
  function appendOutput(item) { invoke("append", [item]); }
  function updateStats(partial) { invoke("update", [partial]); }
  function onChange(handler) {
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }
  return {getState, appendOutput, updateStats, onChange};
}
