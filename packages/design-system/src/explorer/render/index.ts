import { ScreenBuffer } from "../../dashboard/buffer.js";
import { computeExplorerLayout, type ExplorerLayout } from "../layout.js";
import {
  REGION_ALL,
  REGION_DETAIL,
  REGION_FOOTER,
  REGION_HEADER,
  REGION_LIST,
  REGION_MODAL,
  type ExplorerState
} from "../state.js";
import { renderDetail } from "./detail.js";
import { renderFooter } from "./footer.js";
import { renderHeader } from "./header.js";
import { renderList } from "./list.js";
import { renderModal } from "./modal.js";

type RegionRenderer = (state: ExplorerState, screen: ScreenBuffer, layout: ExplorerLayout) => void;

const REGION_RENDERERS: Array<[number, RegionRenderer]> = [
  [REGION_HEADER, renderHeader],
  [REGION_LIST, renderList],
  [REGION_DETAIL, renderDetail],
  [REGION_FOOTER, renderFooter],
  [REGION_MODAL, (state, screen) => renderModal(state, screen)]
];

export function renderExplorer(state: ExplorerState, screen: ScreenBuffer): void {
  const layout = computeExplorerLayout({
    cols: state.size.cols,
    rows: state.size.rows,
    detailHidden: state.layout === "narrow-list-only" || state.layout === "too-narrow"
  });
  const dirty = state.dirty === 0 ? REGION_ALL : state.dirty;

  for (const [region, render] of REGION_RENDERERS) {
    if ((dirty & region) !== 0) {
      render(state, screen, layout);
    }
  }

  if (state.modal !== null && (dirty & REGION_MODAL) === 0) {
    renderModal(state, screen);
  }
}

export { renderDetail } from "./detail.js";
export { renderFooter } from "./footer.js";
export { renderHeader } from "./header.js";
export { renderList } from "./list.js";
export { renderModal } from "./modal.js";
