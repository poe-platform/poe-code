import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure jq, yq, xq, xmllint, htmlq, mdq, and html-to-markdown deep parity matrix", () => {
  it("01_xmllint_exc_c14n_vs_c14n_namespace_visibility_and_attribute_sorting", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/ns.xml":
            "<root xmlns:p=\"urn:p\" xmlns:u=\"urn:unused\" z=\"9\" a=\"1\"><p:item b=\"2\"/></root>\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "c14n=$(xmllint --c14n /workspace/ns.xml)",
            "exc=$(xmllint --exc-c14n /workspace/ns.xml)",
            "printf 'c14n=%s\nexc=%s\n' \"$c14n\" \"$exc\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            'c14n=<root xmlns:p="urn:p" xmlns:u="urn:unused" a="1" z="9"><p:item b="2"></p:item></root>',
            'exc=<root a="1" z="9"><p:item xmlns:p="urn:p" b="2"></p:item></root>',
          ].join("\n"),
        );
      },
    );
  });

  it("02_xmllint_noblanks_xml_space_preserve_and_xpath_text_node_counts", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/blanks.xml": "<root>\n  <item/>\n</root>\n",
          "/workspace/space.xml":
            "<r xml:space=\"preserve\"> <a xml:space=\"default\"> <b/> </a> </r>\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cnt=$(xmllint --noblanks --xpath 'count(/root/text())' /workspace/blanks.xml)",
            "xmllint --noblanks --format -o /workspace/fmt.xml /workspace/blanks.xml",
            "xmllint --noblanks --format /workspace/space.xml > /workspace/space_out.xml",
            "printf 'cnt=%s\n' \"$cnt\"",
            "cat /workspace/fmt.xml",
            "cat /workspace/space_out.xml",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "cnt=0",
            '<?xml version="1.0"?>',
            "<root>",
            "  <item/>",
            "</root>",
            '<?xml version="1.0"?>',
            '<r xml:space="preserve"> <a xml:space="default"><b/></a> </r>',
          ].join("\n"),
        );
      },
    );
  });

  it("03_xmllint_nocdata_text_coalescing_entity_escaping_and_us_ascii_encoding", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/coalesce.xml": "<root>a<![CDATA[b]]>c<![CDATA[d]]></root>",
          "/workspace/ascii.xml": "<root><![CDATA[é<&]]></root>",
          "/workspace/decl.xml": "<?xml version=\"1.0\" standalone=\"yes\"?><root/>",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "cnt=$(xmllint --nocdata --xpath 'count(/root/text())' /workspace/coalesce.xml)",
            "txt=$(xmllint --nocdata --xpath 'string(/root)' /workspace/coalesce.xml)",
            "xmllint --nocdata --encode US-ASCII -o /workspace/out_ascii.xml /workspace/ascii.xml",
            "xmllint --encode UTF-8 /workspace/decl.xml > /workspace/out_decl.xml",
            "printf 'cnt=%s|txt=%s\n' \"$cnt\" \"$txt\"",
            "cat /workspace/out_ascii.xml",
            "cat /workspace/out_decl.xml",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "cnt=1|txt=abcd",
            '<?xml version="1.0" encoding="US-ASCII"?>',
            "<root>&#233;&lt;&amp;</root>",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            "<root/>",
          ].join("\n"),
        );
      },
    );
  });

  it("04_xmllint_xpath_zero_arg_root_functions_unary_minus_nan_substring_and_precision", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/doc.xml":
            "<root><item id=\"a\" n=\"10\">  First  </item><item id=\"b\" n=\"20\"><sub>Second</sub></item></root>",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "s0=$(xmllint --xpath 'normalize-space()' /workspace/doc.xml)",
            "n0=$(xmllint --xpath 'name()' /workspace/doc.xml)",
            "neg=$(xmllint --xpath '-number(/root/item[1]/@n)' /workspace/doc.xml)",
            "nan_sub=$(xmllint --xpath 'substring(\"abc\", number(\"\"))' /workspace/doc.xml)",
            "uni=$(xmllint --xpath 'concat(substring(\"😀abc\", 2), string-length(\"😀a\"))' /workspace/doc.xml)",
            "p1=$(xmllint --xpath '1.23456789' /workspace/doc.xml)",
            "p2=$(xmllint --xpath '999999.9' /workspace/doc.xml)",
            "p3=$(xmllint --xpath '0.00001' /workspace/doc.xml)",
            "printf '%s|%s|%s|%s|%s|%s|%s|%s\n' \"$s0\" \"$n0\" \"$neg\" \"$nan_sub\" \"$uni\" \"$p1\" \"$p2\" \"$p3\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "First Second||-10||abc2|1.23457|1e+06|1e-05");
      },
    );
  });

  it("05_xq_combined_short_flags_sort_keys_arg_argjson_and_join_output", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/svc.xml":
            "<config><service z=\"last\" a=\"first\"><name>api</name><port>8080</port></service></config>",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "rc=$(xq -rc '.config.service | [.name, .port]' /workspace/svc.xml)",
            "sorted=$(xq -c -S '.config.service' /workspace/svc.xml)",
            "with_args=$(xq -r --arg env prod --argjson replicas 3 '\"\\(.config.service.name):\\($env):\\($replicas)\"' /workspace/svc.xml)",
            "joined=$(xq -j '.config.service.name, \"-\", .config.service.port' /workspace/svc.xml)",
            "printf '%s\n%s\n%s\n%s\n' \"$rc\" \"$sorted\" \"$with_args\" \"$joined\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            '["api","8080"]',
            '{"@a":"first","@z":"last","name":"api","port":"8080"}',
            "api:prod:3",
            "api-8080",
          ].join("\n"),
        );
      },
    );
  });

  it("06_yq_xml_input_raw_output_unwrap_scalar_and_combined_short_flags", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/catalog.xml":
            "<catalog><book id=\"b1\"><title>Systems</title><price>49</price></book><book id=\"b2\"><title>Compilers</title><price>65</price></book></catalog>",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "p1=$(yq -p=xml -r '.catalog.book[0].price' /workspace/catalog.xml)",
            "p2=$(yq -p=xml --unwrapScalar '.catalog.book[1].price' /workspace/catalog.xml)",
            "rc=$(yq -p=xml -o=json -I=0 -r '[.catalog.book[].title]' /workspace/catalog.xml)",
            "printf '%s|%s|%s\n' \"$p1\" \"$p2\" \"$rc\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), '49|65|["Systems","Compilers"]');
      },
    );
  });

  it("07_yq_toml_props_shell_csv_and_lua_multi_format_conversions", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/app.toml": [
            "[server]",
            "host = \"127.0.0.1\"",
            "port = 9090",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "js=$(yq -p=toml -o=json -I=0 '.' /workspace/app.toml)",
            "pr=$(yq -p=toml -o=props '.' /workspace/app.toml | paste -sd';' -)",
            "sh=$(yq -p=toml -o=shell '.' /workspace/app.toml | paste -sd';' -)",
            "printf 'js=%s\npr=%s\nsh=%s\n' \"$js\" \"$pr\" \"$sh\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            'js={"server":{"host":"127.0.0.1","port":9090}}',
            "pr=server.host = 127.0.0.1;server.port = 9090",
            "sh=server_host=127.0.0.1;server_port=9090",
          ].join("\n"),
        );
      },
    );
  });

  it("08_yq_front_matter_extract_and_process_with_split_exp", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/guide.md": [
            "---",
            "title: Deployment Guide",
            "version: 2",
            "---",
            "# Heading",
            "Body paragraph.",
            "",
          ].join("\n"),
          "/workspace/multi.yaml": [
            "name: alpha",
            "port: 8001",
            "---",
            "name: beta",
            "port: 8002",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "ext=$(yq -f=extract -o=json -I=0 '.' /workspace/guide.md)",
            "proc=$(yq -f=process '.version = 3' /workspace/guide.md)",
            "cd /workspace && yq -s '.name' /workspace/multi.yaml",
            "a_port=$(yq -r '.port' /workspace/alpha.yml)",
            "b_port=$(yq -r '.port' /workspace/beta.yml)",
            "printf 'ext=%s\na=%s|b=%s\n%s\n' \"$ext\" \"$a_port\" \"$b_port\" \"$proc\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            'ext={"title":"Deployment Guide","version":2}',
            "a=8001|b=8002",
            "---",
            "title: Deployment Guide",
            "version: 3",
            "---",
            "# Heading",
            "Body paragraph.",
          ].join("\n"),
        );
      },
    );
  });

  it("09_csvjson_and_in2csv_json_trailing_zero_float_and_key_roundtrip", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/items.csv": [
            "sku,qty,price,active",
            "A100,4,12.5,true",
            "B200,0,5.0,false",
            "C300,9,2.0,true",
            "",
          ].join("\n"),
          "/workspace/nested.json":
            '{"meta":{"ver":1},"records":[{"id":"r1","score":10.0},{"id":"r2","score":20.5}]}',
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "csvjson --indent 2 /workspace/items.csv > /workspace/items.json",
            "in2csv -f json /workspace/items.json",
            "echo ---",
            "in2csv -f json -k records /workspace/nested.json",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "sku,qty,price,active",
            "A100,4.0,12.5,True",
            "B200,0.0,5.0,False",
            "C300,9.0,2.0,True",
            "---",
            "id,score",
            "r1,10.0",
            "r2,20.5",
          ].join("\n"),
        );
      },
    );
  });

  it("10_html_to_markdown_headings_inline_emphasis_br_hr_and_code_fences", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/rich.html": [
            "<h1>Release</h1>",
            "<p>Line1<br>Line2 with <code>a ` b</code> and <code>`edge`</code></p>",
            "<hr>",
            "<pre><code class=\"hljs language-js\">const x = 1;\n```\nconst y = 2;</code></pre>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec("html-to-markdown /workspace/rich.html");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "# Release",
            "",
            "Line1  ",
            "Line2 with ``a ` b`` and `` `edge` ``",
            "",
            "---",
            "",
            "````js",
            "const x = 1;",
            "```",
            "const y = 2;",
            "````",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("11_html_to_markdown_safe_vs_blocked_urls_ordered_list_start_and_image_alt_escaping", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/links.html": [
            "<p><a href=\"javascript:alert(1)\"><strong>Unsafe</strong></a></p>",
            "<p><a href=\"../a file(1).md#part\">Read Guide</a></p>",
            "<p><img src=\"/logo.png\" alt=\"A [logo]\"></p>",
            "<p><img src=\"data:image/png;base64,AA\" alt=\"fallback-logo\"></p>",
            "<ol start=\"3\">",
            "  <li>Third item</li>",
            "  <li>Fourth item</li>",
            "</ol>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec("html-to-markdown /workspace/links.html");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "**Unsafe**",
            "",
            "[Read Guide](<../a%20file%281%29.md#part>)",
            "",
            "![A \\[logo\\]](</logo.png>)",
            "",
            "fallback\\-logo",
            "",
            "3. Third item",
            "4. Fourth item",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("12_html_to_markdown_tables_with_caption_ragged_rows_no_th_header_and_cell_pipes", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/tables.html": [
            "<table><caption>Metrics</caption><tr><th>Host</th><th>Status</th></tr><tr><td>db-1</td></tr></table>",
            "<table><tr><td>only-data</td></tr></table>",
            "<table><tr><th>Expr</th></tr><tr><td>a|b <code>x|y</code></td></tr></table>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec("html-to-markdown /workspace/tables.html");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "Metrics",
            "",
            "| Host | Status |",
            "| --- | --- |",
            "| db\\-1 |  |",
            "",
            "|  |",
            "| --- |",
            "| only\\-data |",
            "",
            "| Expr |",
            "| --- |",
            "| a\\|b `x\\|y` |",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("13_html_to_markdown_multi_line_blockquote_and_duplicate_attribute_deduplication", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/quote.html": [
            "<blockquote><p>First paragraph</p><p>Second paragraph</p></blockquote>",
            "<p><a href=\"/first\" href=\"javascript:x\">Link</a></p>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec("html-to-markdown /workspace/quote.html");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "> First paragraph",
            ">",
            "> Second paragraph",
            "",
            "[Link](</first>)",
            "",
          ].join("\n"),
        );
      },
    );
  });

  it("14_htmlq_quoted_gt_in_attributes_detect_base_and_complex_css_combinators", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/dom.html": [
            "<html>",
            "  <head><base href=\"https://docs.example.com/v2/guide/\"></head>",
            "  <body>",
            "    <div class=\"card\">",
            "      <h3 class=\"hdr\">Title</h3>",
            "      <p class=\"lead\">Lead</p>",
            "      <p class=\"follow\">Follow</p>",
            "      <a title=\"a > b\" href=\"../api/index.html\">API Link</a>",
            "    </div>",
            "  </body>",
            "</html>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "href=$(htmlq -B -a href '.card > a' -f /workspace/dom.html)",
            "ttl=$(htmlq -a title '.card > a' -f /workspace/dom.html)",
            "adj=$(htmlq -t 'h3.hdr + p' -f /workspace/dom.html)",
            "sib=$(htmlq -t 'h3.hdr ~ p.follow' -f /workspace/dom.html)",
            "printf '%s|%s|%s|%s\n' \"$href\" \"$ttl\" \"$adj\" \"$sib\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          "https://docs.example.com/v2/api/index.html|a > b|Lead|Follow",
        );
      },
    );
  });

  it("15_htmlq_pretty_print_remove_nodes_and_multiple_attribute_extraction", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/widget.html":
            "<section><span class=\"noise\">drop</span><a id=\"lnk\" data-track=\"cta\" href=\"/go\">Go</a></section>",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "attrs=$(htmlq -a id -a data-track -a href 'a#lnk' -f /workspace/widget.html | paste -sd',' -)",
            "clean=$(htmlq -r '.noise' 'section' -f /workspace/widget.html)",
            "printf 'attrs=%s\nclean=%s\n' \"$attrs\" \"$clean\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "attrs=lnk,cta,/go",
            'clean=<section><a id="lnk" data-track="cta" href="/go">Go</a></section>',
          ].join("\n"),
        );
      },
    );
  });

  it("16_mdq_section_hierarchy_piped_filters_and_regex_substitutions", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/runbook.md": [
            "# Operations",
            "",
            "## Incident Response",
            "",
            "- [ ] Triage alerts",
            "- [x] Mitigate traffic spike on edge-01",
            "- [x] Rotate credentials on auth-02",
            "",
            "## Postmortem",
            "",
            "- [x] Publish timeline",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          "mdq -o plain --no-br '#{2} Incident | - [x] !s/([a-z]+)-([0-9]+)/[$1:$2]/' /workspace/runbook.md",
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "Mitigate traffic spike on [edge:01]",
            "Rotate credentials on [auth:02]",
          ].join("\n"),
        );
      },
    );
  });

  it("17_mdq_table_selector_alignments_and_markdown_vs_json_vs_plain_rendering", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/sla.md": [
            "| Tier | Target | Window |",
            "| :--- | :---: | ---: |",
            "| Gold | 99.99% | 5m |",
            "| Silver | 99.9% | 30m |",
            "| Bronze | 99.0% | 4h |",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "js=$(mdq -o json ':-: /^(Tier|Window)$/ :-: /m$/' /workspace/sla.md | jq -c '.items[0].table')",
            "pl=$(mdq -o plain --no-br ':-: /^(Tier|Window)$/ :-: /m$/' /workspace/sla.md | paste -sd'|' -)",
            "printf 'js=%s\npl=%s\n' \"$js\" \"$pl\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            'js={"alignments":["left","right"],"rows":[["Tier","Window"],["Gold","5m"],["Silver","30m"]]}',
            "pl=Tier Window|Gold 5m|Silver 30m",
          ].join("\n"),
        );
      },
    );
  });

  it("18_jq_advanced_builtins_bsearch_transpose_combinations_walk_and_gsub", async () => {
    await withE2EHarness(async (h) => {
      const r = await h.exec(
        [
          "bs=$(jq -nc '[10,20,30,40] | [bsearch(20), bsearch(25)]')",
          "tr=$(jq -nc '[[1,2],[3,4],[5,6]] | transpose')",
          "wk=$(jq -nc '{\"a\":{\"b\":1,\"c\":[2,3]}} | walk(if type == \"number\" then . * 10 else . end)')",
          "st=$(jq -nr '\"__hello-world__\" | ltrimstr(\"__\") | rtrimstr(\"__\") | gsub(\"-\"; \"_\") | ascii_upcase')",
          "printf '%s\n%s\n%s\n%s\n' \"$bs\" \"$tr\" \"$wk\" \"$st\"",
        ].join("\n"),
      );
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(
        r.stdout.trim(),
        [
          "[1,-3]",
          "[[1,3,5],[2,4,6]]",
          '{"a":{"b":10,"c":[20,30]}}',
          "HELLO_WORLD",
        ].join("\n"),
      );
    });
  });

  it("19_end_to_end_xml_to_xq_to_yq_to_html_to_markdown_to_mdq_pipeline", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/spec.xml": [
            "<spec>",
            "  <section title=\"Security\">",
            "    <rule id=\"R1\">Enforce mTLS</rule>",
            "    <rule id=\"R2\">Rotate keys</rule>",
            "  </section>",
            "</spec>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "sec_title=$(xmllint --xpath 'string(/spec/section/@title)' /workspace/spec.xml)",
            "items_html=$(xq -r '.spec.section.rule[] | \"<li>\\(.[\"@id\"]): \\(.[\"#text\"])</li>\"' /workspace/spec.xml | tr -d '\n')",
            "printf '<h2>%s</h2><ul>%s</ul>\n' \"$sec_title\" \"$items_html\" | html-to-markdown > /workspace/spec.md",
            "mdq -o plain --no-br '#{2} Security | -' /workspace/spec.md",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          ["R1: Enforce mTLS", "R2: Rotate keys"].join("\n"),
        );
      },
    );
  });

  it("20_end_to_end_htmlq_table_scrape_to_csvjson_in2csv_xan_and_sqlite3", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/report.html": [
            "<table id=\"perf\">",
            "  <tr><td class=\"csv\">service,latency_ms,ok</td></tr>",
            "  <tr><td class=\"csv\">auth,12.0,true</td></tr>",
            "  <tr><td class=\"csv\">billing,28.5,true</td></tr>",
            "  <tr><td class=\"csv\">search,9.0,false</td></tr>",
            "</table>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "htmlq -t '#perf td.csv' -f /workspace/report.html > /workspace/raw.csv",
            "csvjson --indent 2 /workspace/raw.csv > /workspace/raw.json",
            "in2csv -f json /workspace/raw.json > /workspace/roundtrip.csv",
            "xan filter 'ok == \"True\"' /workspace/roundtrip.csv | xan select service,latency_ms",
            "sqlite3 -markdown :memory: '.mode csv' '.import /workspace/roundtrip.csv perf' '.mode markdown' 'SELECT service, latency_ms FROM perf WHERE ok = \"True\" ORDER BY service;'",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            "service,latency_ms",
            "auth,12.0",
            "billing,28.5",
            "| service | latency_ms |",
            "|---------|------------|",
            "| auth    | 12.0       |",
            "| billing | 28.5       |",
          ].join("\n"),
        );
      },
    );
  });
});
