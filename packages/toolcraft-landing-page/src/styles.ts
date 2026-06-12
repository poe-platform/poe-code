export const CSS = String.raw`
      :root {
        --bg: #ffffff;
        --bg-soft: #f7f7f8;
        --code-bg: #f4f4f6;
        --ink: #18181b;
        --muted: #555560;
        --faint: #666671;
        --line: #8a8a94;
        --line-strong: #8a8a94;
        --accent: {{accent}};
        --accent-soft: #eaf1ff;
        --accent-soft: color-mix(in srgb, {{accent}} 12%, white);
        --tok-comment: #6a737d;
        --tok-str: #0a7d3c;
        --tok-num: #aa5d00;
        --tok-flag: #0550ae;
        --radius: 10px;
        --sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; scroll-padding-top: 84px; }
      body { margin: 0; color: var(--ink); background: var(--bg); font-family: var(--sans); line-height: 1.55; }
      a { color: var(--accent); }
      a, button { border-radius: 4px; }
      :is(a, button):focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .skip-link {
        position: fixed;
        z-index: 100;
        top: 12px;
        left: 12px;
        padding: 10px 14px;
        color: #ffffff;
        background: var(--accent);
        font-weight: 700;
        transform: translateY(-160%);
      }
      .skip-link:focus-visible { transform: translateY(0); }
      .wrap { width: min(100% - 40px, 1040px); margin-inline: auto; }
      .nav { position: sticky; top: 0; z-index: 10; border-bottom: 1px solid var(--line); background: rgba(255,255,255,.96); }
      .nav-inner { width: min(100% - 40px, 1040px); min-height: 60px; margin-inline: auto; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
      .brand { font-family: var(--mono); font-weight: 700; }
      .nav-links { display: flex; flex-wrap: wrap; gap: 18px; }
      .nav-links a { color: var(--muted); text-decoration-thickness: 1px; text-underline-offset: 4px; }
      .hero { position: relative; padding: 92px 0 72px; overflow: hidden; }
      .hero::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          radial-gradient(ellipse 52% 60% at 78% 0%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 70%),
          radial-gradient(ellipse 40% 50% at 12% 100%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 70%);
        pointer-events: none;
      }
      .hero .wrap { position: relative; }
      .eyebrow, .section-label { color: var(--faint); font-family: var(--mono); font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
      .title { max-width: 760px; margin: 12px 0 18px; font-size: clamp(42px, 7vw, 72px); line-height: 1.02; letter-spacing: -.045em; }
      .title-accent {
        background: linear-gradient(110deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #ff3d81));
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }
      .tagline, .section-intro { color: var(--muted); }
      .tagline { max-width: 720px; font-size: 20px; }
      .hero-actions, .quickstart-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
      .button { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; padding: 10px 16px; border: 1px solid var(--line-strong); border-radius: 8px; font-weight: 700; text-decoration: none; }
      .button-primary { border-color: var(--accent); color: #ffffff; background: var(--accent); }
      .button-secondary { color: var(--ink); background: var(--bg); }
      .button:hover { transform: translateY(-1px); }
      .install { display: inline-flex; max-width: 100%; margin-top: 22px; border: 1px solid var(--line-strong); border-radius: var(--radius); overflow: hidden; background: var(--code-bg); }
      .install code { padding: 12px 16px; overflow-x: auto; font-family: var(--mono); white-space: nowrap; }
      .copy { border: 0; border-left: 1px solid var(--line-strong); padding: 0 16px; color: var(--muted); background: transparent; cursor: pointer; font: inherit; }
      .copy:hover, .copy[data-copied="true"] { color: var(--accent); background: var(--accent-soft); }
      main section { padding: 64px 0; border-top: 1px solid var(--line); }
      .section-title { margin: 6px 0 12px; font-size: clamp(30px, 5vw, 44px); line-height: 1.15; }
      .section-intro { max-width: 680px; }
      .feature, .step { border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; transition: border-color .15s ease; }
      .feature:hover { border-color: var(--accent); }
      pre, code { font-family: var(--mono); }
      pre { max-width: 100%; overflow-x: auto; }
      .tok-comment { color: var(--tok-comment); font-style: italic; }
      .tok-str { color: var(--tok-str); }
      .tok-kw { color: var(--accent); font-weight: 600; }
      .tok-num { color: var(--tok-num); }
      .tok-flag { color: var(--tok-flag); }
      .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 30px 0 0; padding: 0; list-style: none; }
      .step-number { color: var(--accent); font-family: var(--mono); font-size: 17px; font-weight: 700; letter-spacing: .08em; }
      .step h3 { margin: 14px 0 8px; }
      .step p { margin: 0; color: var(--muted); }
      .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-top: 30px; }
      .use-cases { margin-top: 18px; }
      .feature h3, .flow-surface-name { font-family: var(--mono); }
      .use-case { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 20px 56px; align-items: center; padding: 36px 0; }
      .use-case + .use-case { border-top: 1px solid var(--line); }
      .use-case:nth-of-type(even) .use-case-text { order: 2; }
      .use-case h3 { margin: 0; font-size: 22px; letter-spacing: -.015em; }
      .use-case p, .feature p { color: var(--muted); margin: 10px 0 0; }
      .use-case-code { margin: 0; padding: 18px 20px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--code-bg); font-size: 13px; line-height: 1.6; }
      .flow { margin-top: 30px; display: grid; gap: 18px; align-items: start; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); }
      .flow > * { min-width: 0; }
      .flow-source { margin: 0; padding: 18px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--code-bg); font-size: 13px; line-height: 1.5; }
      .flow-surfaces { display: grid; gap: 16px; }
      .flow-surface { min-width: 0; }
      .flow-surface-head { margin-bottom: 8px; }
      .flow-surface-name { color: var(--accent); font-family: var(--mono); font-size: 13px; font-weight: 700; letter-spacing: .04em; }
      .flow-surface-code { margin: 0; padding: 16px 18px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--code-bg); font-size: 13px; line-height: 1.6; }
      @media (max-width: 820px) {
        .flow { grid-template-columns: 1fr; }
        .use-case { grid-template-columns: 1fr; padding: 28px 0; }
        .use-case:nth-of-type(even) .use-case-text { order: 0; }
      }
      .quickstart pre { margin: 0; padding: 18px 20px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--code-bg); font-size: 13px; line-height: 1.6; }
      .docs-layout { display: grid; grid-template-columns: minmax(240px, .8fr) minmax(0, 1.2fr); gap: 56px; align-items: start; }
      .text-link { display: inline-block; margin-top: 12px; font-weight: 700; text-underline-offset: 4px; }
      .docs-grid { display: grid; grid-template-columns: repeat(2, 1fr); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
      .doc-card { padding: 22px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); color: var(--ink); text-decoration: none; }
      .doc-card span { color: var(--accent); font-family: var(--mono); font-size: 17px; font-weight: 700; }
      .doc-card strong, .doc-card small { display: block; }
      .doc-card strong { margin-top: 16px; font-size: 18px; }
      .doc-card small { margin-top: 8px; color: var(--muted); font-size: 14px; }
      .doc-card:hover { background: var(--accent-soft); }
      .quickstart { background: var(--bg-soft); }
      .quickstart pre { margin-top: 28px; }
      footer { padding: 40px 0 64px; border-top: 1px solid var(--line); color: var(--faint); }
      footer .wrap { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
      @media (prefers-reduced-motion: reduce) {
        html { scroll-behavior: auto; }
        .button:hover { transform: none; }
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #111113;
          --bg-soft: #19191d;
          --code-bg: #202026;
          --ink: #f4f4f5;
          --muted: #c4c4cc;
          --faint: #a3a3ad;
          --line: #3f3f48;
          --line-strong: #5b5b66;
          --accent: #9dc1ff;
          --accent: color-mix(in srgb, {{accent}} 55%, white);
          --accent-soft: rgba(157, 193, 255, .18);
          --accent-soft: color-mix(in srgb, {{accent}} 24%, transparent);
          --tok-comment: #8b949e;
          --tok-str: #7ee787;
          --tok-num: #ffa657;
          --tok-flag: #79c0ff;
        }
        .nav { background: rgba(17,17,19,.96); }
      }
      @media (max-width: 620px) {
        .wrap, .nav-inner { width: min(100% - 28px, 1040px); }
        .nav-inner { align-items: flex-start; flex-direction: column; gap: 10px; padding-block: 14px; }
        .nav-links { width: 100%; gap: 8px; }
        .nav-links a { min-height: 44px; display: inline-flex; align-items: center; padding: 8px 10px; border: 1px solid var(--line); }
        .hero { padding-top: 64px; }
        .hero-actions { align-items: stretch; flex-direction: column; }
        .install { width: 100%; flex-direction: column; }
        .install code { width: 100%; }
        .install .copy { min-height: 44px; border-top: 1px solid var(--line-strong); border-left: 0; }
        .feature, .step { padding: 16px; }
        .steps, .docs-layout, .docs-grid { grid-template-columns: 1fr; }
        .docs-layout { gap: 28px; }
      }
      @media print {
        :root {
          --bg: #ffffff;
          --bg-soft: #ffffff;
          --code-bg: #ffffff;
          --ink: #000000;
          --muted: #333333;
          --faint: #555555;
          --line: #aaaaaa;
          --line-strong: #777777;
        }
        html { scroll-padding-top: 0; }
        body, .use-case, .feature, .step, .flow-source, .flow-surface-code, .quickstart pre, .use-case-code { background: transparent; }
        .hero::before { display: none; }
        .title-accent { background: none; color: inherit; }
        .nav, .copy, .skip-link { display: none; }
        .hero, main section, footer { padding-block: 24px; }
        .use-case, .feature, .step, .doc-card, pre { break-inside: avoid; }
        .flow { grid-template-columns: 1fr; }
        .install code, pre { overflow: visible; white-space: pre-wrap; }
        a { color: inherit; text-decoration: underline; }
      }
`;
