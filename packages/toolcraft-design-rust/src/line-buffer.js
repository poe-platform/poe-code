import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
export function createDashboardLineBuffer(emit) {
  const state = new native.NativeDashboardLineBuffer();
  return {
    preview: state.preview.bind(state),
    push(chunk) {
      const { lines, remaining } = state.prepare(chunk);
      for (const raw of lines) {
        emit(state.line(raw));
        state.lineEmitted();
      }
      state.finish(remaining);
    },
    flush() {
      if (!state.hasPending()) return;
      emit(state.preview());
      state.resetPending();
    }
  };
}
export function createStreamingDashboardLineBuffer(emit) {
  let id = randomUUID(),
    lastPreview = "";
  const lines = createDashboardLineBuffer((line) => {
    if (line.length === 0 || line !== lastPreview) emit(line, id);
    id = randomUUID();
    lastPreview = "";
  });
  return {
    push(chunk) {
      if (chunk.length === 0) return;
      lines.push(chunk);
      const preview = lines.preview();
      if (preview.length > 0 && preview !== lastPreview) {
        lastPreview = preview;
        emit(preview, id);
      }
    },
    flush: lines.flush
  };
}
