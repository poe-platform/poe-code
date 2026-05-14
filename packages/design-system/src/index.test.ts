import { describe, expect, expectTypeOf, it } from "vitest";
import {
  dashboard,
  createDashboard,
  explorer,
  parse,
  render,
  renderMarkdown,
  runExplorer,
  singleDetail,
  text,
  type Action,
  type ActionContext,
  type Dashboard,
  type DashboardOptions,
  type Detail,
  type DetailItem,
  type ExplorerConfig,
  type MdNode,
  type RenderOptions,
  type Row,
  type Tone
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

  it("re-exports text helpers from the root barrel", () => {
    expect(text.sectionHeader("Title")).toBeTypeOf("string");
  });

  it("re-exports explorer helpers from the root barrel", () => {
    expect(explorer.runExplorer).toBe(runExplorer);
    expect(explorer.singleDetail).toBe(singleDetail);
    expect(runExplorer).toBeTypeOf("function");
    expect(singleDetail).toBeTypeOf("function");
  });

  it("re-exports explorer types from the root barrel", () => {
    expectTypeOf<Tone>().toEqualTypeOf<"success" | "warning" | "error" | "info" | "muted">();
    expectTypeOf<Row>().toMatchTypeOf<{
      id: string;
      title: string;
      subtitle?: string;
      badge?: { text: string; tone?: Tone };
      group?: string;
    }>();
    expectTypeOf<DetailItem>().toMatchTypeOf<{
      id: string;
      title?: string;
      subtitle?: string;
      badge?: { text: string; tone?: Tone };
      render: (ctx: { row: Row }) => string | Promise<string>;
    }>();
    expectTypeOf<Detail<void>>().toMatchTypeOf<{
      items: (row: Row, ctx: { row: Row }) => Promise<DetailItem[]>;
      actions?: Action<void>[];
    }>();
    expectTypeOf<ActionContext<void>>().toMatchTypeOf<{
      row: Row;
      rows: Row[];
      item?: DetailItem;
      filter: string;
    }>();
    expectTypeOf<ExplorerConfig<void>>().toMatchTypeOf<{
      title: string;
      rows: () => Promise<Row[]>;
      detail: Detail<void>;
      actions: Action<void>[];
    }>();
  });

  it("exposes the same dashboard factory from the dashboard barrel", () => {
    expect(createDashboardFromDashboardBarrel).toBe(createDashboard);
    expect(defaultHints()).toEqual([
      { key: "q", label: "Quit" },
      { key: "e", label: "Edit" },
      { key: "l", label: "Log" },
      { key: "p", label: "Pause" },
      { key: "r", label: "Retry" }
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
      | "forceQuit"
      | "quit"
      | "edit"
      | "pause"
      | "retry"
      | "view-log"
    >();
    expectTypeOf<DashboardState>().toMatchTypeOf<{
      output: OutputItem[];
      stats: DashboardStats;
    }>();
  });
});
