import { describe, expect, expectTypeOf, it } from "vitest";
import {
  dashboard,
  createDashboard,
  color,
  explorer,
  parse,
  render,
  renderHtml,
  renderMarkdown,
  renderMarkdownHtml,
  runExplorer,
  openExternal,
  renderTemplate,
  singleDetail,
  text,
  type Color,
  type Action,
  type ActionContext,
  type Dashboard,
  type DashboardOptions,
  type Detail,
  type DetailCtx,
  type DetailItem,
  type ExplorerConfig,
  type MdNode,
  type HtmlRenderOptions,
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
    expect(renderMarkdownHtml("# Heading")).toBe(renderHtml(parse("# Heading").ast));
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
    expectTypeOf<HtmlRenderOptions>().toMatchTypeOf<{
      showFrontmatter?: boolean;
      allowRawHtml?: boolean;
    }>();
  });

  it("re-exports dashboard helpers from the root barrel", () => {
    expect(dashboard.createDashboard).toBe(createDashboard);
  });

  it("re-exports text helpers from the root barrel", () => {
    expect(text.sectionHeader("Title")).toBeTypeOf("string");
  });

  it("re-exports template rendering from the root barrel", () => {
    expect(renderTemplate("Hello {{name}}", { name: "K" })).toBe("Hello K");
  });

  it("re-exports color helpers from the root barrel", () => {
    expect(color.red.bold("Title")).toBeTypeOf("string");
    expectTypeOf(color).toMatchTypeOf<Color>();
  });

  it("re-exports explorer helpers from the root barrel", () => {
    expect(explorer.runExplorer).toBe(runExplorer);
    expect(explorer.singleDetail).toBe(singleDetail);
    expectTypeOf(explorer.runExplorer).toEqualTypeOf(runExplorer);
    expectTypeOf(explorer.singleDetail).toEqualTypeOf(singleDetail);
    expect(runExplorer).toBeTypeOf("function");
    expect(singleDetail).toBeTypeOf("function");
  });

  it("re-exports browser helpers from the root barrel", () => {
    expect(openExternal).toBeTypeOf("function");
  });

  it("re-exports explorer types from the root barrel", () => {
    expectTypeOf(runExplorer).toEqualTypeOf<
      <R = void>(config: ExplorerConfig<R>) => Promise<R | null>
    >();
    expectTypeOf(singleDetail).toEqualTypeOf<
      <R>(render: (row: Row, ctx: DetailCtx) => string | Promise<string>) => Detail<R>
    >();
    expectTypeOf<Tone>().toEqualTypeOf<"success" | "warning" | "error" | "info" | "muted">();
    expectTypeOf<Row>().toEqualTypeOf<{
      id: string;
      title: string;
      subtitle?: string;
      badge?: { text: string; tone?: Tone };
      group?: string;
    }>();
    expectTypeOf<DetailItem>().toEqualTypeOf<{
      id: string;
      title?: string;
      subtitle?: string;
      badge?: { text: string; tone?: Tone };
      render: (ctx: DetailCtx) => string | Promise<string>;
    }>();
    expectTypeOf<Detail<void>>().toEqualTypeOf<{
      items: (row: Row, ctx: DetailCtx) => Promise<DetailItem[]>;
      actions?: Action<void>[];
    }>();
    expectTypeOf<DetailCtx>().toEqualTypeOf<{
      width: number;
      height: number;
      signal: AbortSignal;
      row: Row;
    }>();
    expectTypeOf<Action<void>>().toEqualTypeOf<{
      id: string;
      label: string | (() => string);
      key?: string | string[];
      predicate?: (ctx: ActionContext<void>) => boolean;
      handler: (ctx: ActionContext<void>) => void | Promise<void>;
      destructive?: boolean;
      primary?: boolean;
      showInFooter?: boolean;
    }>();
    expectTypeOf<ActionContext<void>>().toEqualTypeOf<{
      row: Row;
      rows: Row[];
      item?: DetailItem;
      filter: string;
      refresh: () => Promise<void>;
      suspendAnd: <T>(fn: () => Promise<T>) => Promise<T>;
      toast: (msg: string, tone?: Tone) => void;
      confirm: (prompt: string) => Promise<boolean>;
      exit: (after?: () => void | Promise<void>) => void;
    }>();
    expectTypeOf<ExplorerConfig<void>>().toEqualTypeOf<{
      title: string;
      rows: () => Promise<Row[]>;
      detail: Detail<void>;
      actions: Action<void>[];
      reorder?: { onReorder: (orderedIds: string[]) => void | Promise<void> };
      multiSelect?: boolean;
      keybindOverrides?: Record<string, string | string[]>;
      emptyHint?: string;
      initialFilter?: string;
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
