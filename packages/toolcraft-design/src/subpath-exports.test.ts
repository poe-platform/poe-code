import { describe, expect, it } from "vitest";
import { renderMarkdownHtml } from "./render-markdown-html.js";
import { renderHtml } from "./render-html.js";
import { renderTable } from "./render-table.js";
import { renderDetailCard } from "./render-detail-card.js";
import { runExplorer } from "./run-explorer.js";
import { createDashboard } from "./create-dashboard.js";
import { intro } from "./intro.js";
import { getTheme } from "./get-theme.js";
import * as root from "./index.js";

describe("toolcraft-design flat subpath modules", () => {
  it("re-exports representative public design helpers without wrapper functions", () => {
    expect(renderMarkdownHtml).toBe(root.renderMarkdownHtml);
    expect(renderHtml).toBe(root.renderHtml);
    expect(renderTable).toBe(root.renderTable);
    expect(renderDetailCard).toBe(root.renderDetailCard);
    expect(runExplorer).toBe(root.runExplorer);
    expect(createDashboard).toBe(root.createDashboard);
    expect(intro).toBe(root.intro);
    expect(getTheme).toBe(root.getTheme);
  });
});
