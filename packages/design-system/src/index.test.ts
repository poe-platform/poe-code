import { describe, expect, expectTypeOf, it } from "vitest";
import {
  dashboard,
  createDashboard,
  parse,
  render,
  renderMarkdown,
  type Dashboard,
  type DashboardOptions,
  type MdNode,
  type RenderOptions
} from "./index.js";
import {
  createDashboard as createDashboardFromDashboardBarrel,
  defaultHints,
  type Command,
  type DashboardState,
  type DashboardStats,
  type FooterHint,
  type OutputItem,
  type OutputItemKind
} from "./dashboard/index.js";

describe("design-system root exports", () => {
  it("re-exports terminal markdown helpers", () => {
    expect(renderMarkdown("# Heading")).toBe(render(parse("# Heading").ast));
  });

  it("re-exports renderMarkdown with render options intact", () => {
    const markdown = ["---", "title: Heading", "---", "", "Body text"].join("\n");

    expect(renderMarkdown(markdown, { showFrontmatter: true })).toBe(
      render(parse(markdown).ast, { showFrontmatter: true })
    );
  });

  it("re-exports terminal markdown types", () => {
    expectTypeOf<MdNode>().toMatchTypeOf<{ type: string }>();
    expectTypeOf<RenderOptions>().toMatchTypeOf<{
      width?: number;
      showFrontmatter?: boolean;
    }>();
  });

  it("re-exports dashboard helpers from the root barrel", () => {
    expect(dashboard.createDashboard).toBe(createDashboard);
  });

  it("exposes the same dashboard factory from the dashboard barrel", () => {
    expect(createDashboardFromDashboardBarrel).toBe(createDashboard);
    expect(defaultHints()).toEqual([
      { key: "q", label: "Quit" },
      { key: "e", label: "Edit" },
      { key: "p", label: "Pause" },
      { key: "r", label: "Retry" },
      { key: "↑↓", label: "Scroll" },
      { key: "F", label: "Follow" }
    ]);
  });

  it("re-exports dashboard types from the root and dashboard barrels", () => {
    expectTypeOf<Dashboard>().toMatchTypeOf<{
      start: () => void;
      stop: () => void;
      destroy: () => void;
    }>();
    expectTypeOf<DashboardOptions>().toMatchTypeOf<{
      title?: string;
      rightPaneWidth?: number;
      hints?: FooterHint[];
    }>();
    expectTypeOf<OutputItem>().toMatchTypeOf<{
      kind: OutputItemKind;
      text: string;
      ts: number;
    }>();
    expectTypeOf<DashboardStats>().toMatchTypeOf<{
      status: "idle" | "running" | "paused" | "done" | "error";
      iterations: number;
      tokensIn: number;
      tokensOut: number;
      elapsedMs: number;
    }>();
    expectTypeOf<Command>().toEqualTypeOf<
      | "quit"
      | "edit"
      | "pause"
      | "retry"
      | "scrollUp"
      | "scrollDown"
      | "pageUp"
      | "pageDown"
      | "scrollToTop"
      | "scrollToBottom"
    >();
    expectTypeOf<DashboardState>().toMatchTypeOf<{
      output: OutputItem[];
      stats: DashboardStats;
    }>();
  });
});
