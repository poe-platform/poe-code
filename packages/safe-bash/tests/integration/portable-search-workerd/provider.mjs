import { EreLedger, compileEre, matchEre } from "@poe-platform/safe-bash/browser";

export function boundedProvider({ work = 262144, onActive } = {}) {
  const evidence = { created: 0, terminated: 0, active: 0, pending: 0, work: 0, listeners: 0 };
  return {
    evidence,
    createWorker() {
      evidence.created++;
      const controller = new AbortController();
      const listeners = new Map();
      const pending = new Set();
      let closing;
      const emit = (event, value) => {
        for (const listener of listeners.get(event) ?? []) listener(value);
      };
      queueMicrotask(() => { if (!closing) emit("message", { ready: true }); });
      return {
        on(event, listener) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event).add(listener);
          evidence.listeners++;
        },
        off(event, listener) {
          if (listeners.get(event)?.delete(listener)) evidence.listeners--;
        },
        postMessage(request) {
          if (closing || pending.size) throw new Error("provider is closed or busy");
          const task = Promise.resolve().then(async () => {
            const ledger = new EreLedger({ maxExpansionBytes: 8192, maxExpansionFields: 1024 }, { work });
            evidence.pending++;
            try {
              const { descriptor, rows, id } = request;
              if (!["grep", "rg"].includes(descriptor.kind) || descriptor.patterns.length !== 1) throw new Error("acceptance provider requires one grep/rg pattern");
              if (descriptor.insensitive || descriptor.case && descriptor.case !== "sensitive" || descriptor.word) throw new Error("acceptance provider requires case-sensitive non-word matching");
              if (rows.length > 128 || rows.reduce((bytes, row) => bytes + row.bytes.length, 0) > 8192) throw new Error("provider input byte limit exceeded");
              const pattern = descriptor.patterns[0];
              if (pattern.length > 256) throw new Error("provider pattern byte limit exceeded");
              if (descriptor.kind === "grep" && !descriptor.extended && !descriptor.fixed && [...pattern].some(character => "\\()+?{}|".includes(character))) throw new Error("acceptance provider requires -E for extended syntax");
              const fragments = [
                ...(descriptor.whole ? [{ text: "^(", literal: false }] : []),
                { text: pattern, literal: descriptor.fixed },
                ...(descriptor.whole ? [{ text: ")$", literal: false }] : []),
              ];
              const program = await compileEre(fragments, ledger, controller.signal);
              const results = [];
              for (const row of rows) {
                if (row.all) throw new Error("acceptance provider supports selection, not all-match enumeration");
                ledger.charge("allocationUnits", row.bytes.length + 2, controller.signal);
                const subject = Array.from(row.bytes, byte => String.fromCharCode(byte)).join("");
                evidence.active++;
                try {
                  onActive?.();
                  const result = await matchEre(program, subject, ledger, controller.signal);
                  results.push(result.matched ? new Float64Array([result.captures[0].start, result.captures[0].end]) : new Float64Array());
                } finally { evidence.active--; }
              }
              if (!closing) emit("message", { id, results });
            } catch (error) {
              if (!closing) emit("message", { id: request.id, error: String(error.message).slice(0, 512) });
            } finally {
              evidence.work += ledger.usage.work;
              evidence.pending--;
            }
          });
          pending.add(task);
          void task.then(() => pending.delete(task), () => pending.delete(task));
        },
        terminate() {
          if (!closing) {
            controller.abort(new Error("provider terminated"));
            evidence.terminated++;
            closing = Promise.allSettled([...pending]).then(() => {});
          }
          return closing;
        },
      };
    },
  };
}
