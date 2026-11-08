import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("obscure xmllint, htmlq, and mdq deep parity matrix", () => {
  it("01_xmllint_xpath_scalar_string_functions_concat_normalize_substring_translate", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/release.xml": [
            "<release env=\"prod\" tag=\"v2.4.1-rc3\" sha=\"9f8e7d6c5b4a3210\">",
            "  <title>    Core   Platform   Engine   </title>",
            "</release>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "c1=$(xmllint --xpath 'concat(string(/release/@env), \":\", normalize-space(/release/title))' /workspace/release.xml)",
            "c2=$(xmllint --xpath 'substring(string(/release/@sha), 1, 7)' /workspace/release.xml)",
            "c3=$(xmllint --xpath 'substring-before(string(/release/@tag), \"-\")' /workspace/release.xml)",
            "c4=$(xmllint --xpath 'substring-after(string(/release/@tag), \"-\")' /workspace/release.xml)",
            "c5=$(xmllint --xpath 'string-length(normalize-space(/release/title))' /workspace/release.xml)",
            "c6=$(xmllint --xpath 'translate(string(/release/@env), \"prod\", \"PROD\")' /workspace/release.xml)",
            "printf '%s|%s|%s|%s|%s|%s\\n' \"$c1\" \"$c2\" \"$c3\" \"$c4\" \"$c5\" \"$c6\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          "prod:Core Platform Engine|9f8e7d6|v2.4.1|rc3|20|PROD",
        );
      },
    );
  });

  it("02_xmllint_xpath_numeric_and_boolean_functions_floor_ceiling_round_number_not", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/metrics.xml": [
            "<metrics>",
            "  <metric id=\"m1\"><score>1.2</score></metric>",
            "  <metric id=\"m2\"><score>2.4</score></metric>",
            "  <metric id=\"m3\"><score>3.8</score></metric>",
            "</metrics>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "fl=$(xmllint --xpath 'floor(sum(//metric/score))' /workspace/metrics.xml)",
            "ce=$(xmllint --xpath 'ceiling(sum(//metric/score))' /workspace/metrics.xml)",
            "ro=$(xmllint --xpath 'round(sum(//metric/score))' /workspace/metrics.xml)",
            "add=$(xmllint --xpath 'number(//metric[@id=\"m1\"]/score) + number(//metric[@id=\"m3\"]/score)' /workspace/metrics.xml)",
            "no=$(xmllint --xpath 'not(//metric[@id=\"missing\"])' /workspace/metrics.xml)",
            "cnt=$(xmllint --xpath 'count(//metric[score > 2.0])' /workspace/metrics.xml)",
            "printf '%s|%s|%s|%s|%s|%s\\n' \"$fl\" \"$ce\" \"$ro\" \"$add\" \"$no\" \"$cnt\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "7|8|7|5|true|2");
      },
    );
  });

  it("03_xmllint_xpath_function_predicates_contains_starts_with_position_and_or_not", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/services.xml": [
            "<services>",
            "  <service name=\"auth-core\" region=\"us-east\" disabled=\"false\"><endpoint>/api/v2/login</endpoint></service>",
            "  <service name=\"auth-legacy\" region=\"us-east\" disabled=\"true\"><endpoint>/api/v1/login</endpoint></service>",
            "  <service name=\"billing-api\" region=\"eu-west\" disabled=\"false\"><endpoint>/api/v2/charge</endpoint></service>",
            "  <service name=\"search-v2\" region=\"ap-east\" disabled=\"false\"><endpoint>/api/v2/query</endpoint></service>",
            "</services>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "s1=$(xmllint --xpath 'string(//service[starts-with(@name, \"auth-\") and contains(endpoint, \"/v2/\")]/@name)' /workspace/services.xml)",
            "s2=$(xmllint --xpath '//service[string-length(@region) = 7 and not(@disabled = \"true\")]/endpoint/text()' /workspace/services.xml | paste -sd',' -)",
            "s3=$(xmllint --xpath '//service[position() > 1 and position() < 4]/endpoint/text()' /workspace/services.xml | paste -sd',' -)",
            "printf 's1=%s|s2=%s|s3=%s\\n' \"$s1\" \"$s2\" \"$s3\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          "s1=auth-core|s2=/api/v2/login,/api/v2/charge,/api/v2/query|s3=/api/v1/login,/api/v2/charge",
        );
      },
    );
  });

  it("04_xmllint_xpath_namespace_functions_name_local_name_namespace_uri", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/soap.xml": [
            "<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:app=\"urn:example:app\">",
            "  <soap:Body>",
            "    <app:GetUserResponse>",
            "      <app:UserId>u-9001</app:UserId>",
            "    </app:GetUserResponse>",
            "  </soap:Body>",
            "</soap:Envelope>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "nm=$(xmllint --xpath 'name(/soap:Envelope/soap:Body/*[1])' /workspace/soap.xml)",
            "ln=$(xmllint --xpath 'local-name(/soap:Envelope/soap:Body/*[1])' /workspace/soap.xml)",
            "ns=$(xmllint --xpath 'namespace-uri(/soap:Envelope/soap:Body/*[1])' /workspace/soap.xml)",
            "uid=$(xmllint --xpath 'string(//*[local-name()=\"UserId\" and namespace-uri()=\"urn:example:app\"])' /workspace/soap.xml)",
            "printf '%s|%s|%s|%s\\n' \"$nm\" \"$ln\" \"$ns\" \"$uid\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          "app:GetUserResponse|GetUserResponse|urn:example:app|u-9001",
        );
      },
    );
  });

  it("05_xmllint_xpath_parent_self_axes_union_and_attribute_node_serialization", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/topology.xml": [
            "<topology>",
            "  <cluster region=\"us-east\">",
            "    <primary><node id=\"p1\"><status>healthy</status></node></primary>",
            "    <replica><node id=\"r1\"><status>degraded</status></node></replica>",
            "  </cluster>",
            "</topology>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "deg_id=$(xmllint --xpath 'string(//status[.=\"degraded\"]/../@id)' /workspace/topology.xml)",
            "tot=$(xmllint --xpath 'count(//primary/node | //replica/node)' /workspace/topology.xml)",
            "attr=$(xmllint --xpath '/topology/cluster/@region' /workspace/topology.xml)",
            "printf '%s|%s|%s\\n' \"$deg_id\" \"$tot\" \"$attr\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), 'r1|2| region="us-east"');
      },
    );
  });

  it("06_xmllint_format_nocdata_noblanks_encode_and_output_file", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/cdata.xml": "<doc><msg><![CDATA[a < b & c]]></msg><item>ok</item></doc>\n",
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "xmllint --format --nocdata --encode UTF-8 -o /workspace/out.xml /workspace/cdata.xml",
            "cat /workspace/out.xml",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.match(r.stdout, /^<\?xml version="1\.0" encoding="UTF-8"\?>/m);
        assert.match(r.stdout, /<msg>a &lt; b &amp; c<\/msg>/);
        assert.doesNotMatch(r.stdout, /CDATA/);
      },
    );
  });

  it("07_xmllint_c14n_attribute_and_namespace_canonicalization", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/raw.xml":
            "<root z=\"9\" a=\"1\" xmlns:b=\"urn:b\" xmlns=\"urn:def\"><child flag=\"x &amp; y\"/><empty/></root>\n",
        },
      },
      async (h) => {
        const r = await h.exec("xmllint --c14n /workspace/raw.xml");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          "<root xmlns=\"urn:def\" xmlns:b=\"urn:b\" a=\"1\" z=\"9\"><child flag=\"x &amp; y\"></child><empty></empty></root>",
        );
      },
    );
  });

  it("08_xmllint_recover_flag_and_error_exit_codes_for_empty_xpath_and_invalid_xml", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/valid.xml": "<root><item>1</item></root>\n",
          "/workspace/broken.xml": "<root><unclosed></root>\n",
        },
      },
      async (h) => {
        const emptyXpath = await h.exec("xmllint --xpath '//nonexistent' /workspace/valid.xml");
        assert.notEqual(emptyXpath.exitCode, 0);

        const brokenStrict = await h.exec("xmllint --noout /workspace/broken.xml");
        assert.notEqual(brokenStrict.exitCode, 0);

        const recovered = await h.exec("xmllint --recover /workspace/broken.xml");
        assert.equal(recovered.exitCode, 0, recovered.stderr);
        assert.match(recovered.stdout, /<root>/);
      },
    );
  });

  it("09_htmlq_structural_type_pseudo_classes_first_last_only_of_type_only_child_empty", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/types.html": [
            "<section>",
            "  <h2>Heading Only</h2>",
            "  <p>First Para</p>",
            "  <span>Badge</span>",
            "  <p>Middle Para</p>",
            "  <p>Last Para</p>",
            "  <span class=\"placeholder\"></span>",
            "  <div class=\"box\"><em>Solo Child</em></div>",
            "</section>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "p_first=$(htmlq -t 'section > p:first-of-type' -f /workspace/types.html)",
            "p_last=$(htmlq -t 'section > p:last-of-type' -f /workspace/types.html)",
            "h_only=$(htmlq -t 'section > h2:only-of-type' -f /workspace/types.html)",
            "solo=$(htmlq -t '.box > em:only-child' -f /workspace/types.html)",
            "emp=$(htmlq -a class 'section > span:empty' -f /workspace/types.html)",
            "printf '%s|%s|%s|%s|%s\\n' \"$p_first\" \"$p_last\" \"$h_only\" \"$solo\" \"$emp\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          "First Para|Last Para|Heading Only|Solo Child|placeholder",
        );
      },
    );
  });

  it("10_htmlq_an_plus_b_nth_child_nth_last_child_nth_of_type_nth_last_of_type", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/nth.html": [
            "<ul>",
            "  <li>1</li>",
            "  <li>2</li>",
            "  <li>3</li>",
            "  <li>4</li>",
            "  <li>5</li>",
            "  <li>6</li>",
            "</ul>",
            "<div class=\"mixed\">",
            "  <span>s1</span><p>p1</p><span>s2</span><p>p2</p><p>p3</p>",
            "</div>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "odd=$(htmlq -t 'ul > li:nth-child(2n+1)' -f /workspace/nth.html | paste -sd',' -)",
            "step3=$(htmlq -t 'ul > li:nth-child(3n-1)' -f /workspace/nth.html | paste -sd',' -)",
            "last2=$(htmlq -t 'ul > li:nth-last-child(2)' -f /workspace/nth.html)",
            "p_even=$(htmlq -t '.mixed > p:nth-of-type(2n)' -f /workspace/nth.html)",
            "p_last=$(htmlq -t '.mixed > p:nth-last-of-type(1)' -f /workspace/nth.html)",
            "printf 'odd=%s|3n-1=%s|last2=%s|peven=%s|plast=%s\\n' \"$odd\" \"$step3\" \"$last2\" \"$p_even\" \"$p_last\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          "odd=1,3,5|3n-1=2,5|last2=5|peven=p2|plast=p3",
        );
      },
    );
  });

  it("11_htmlq_case_insensitive_attribute_selectors_and_word_prefix_operators", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/attrs.html": [
            "<div>",
            "  <a href=\"HTTPS://DOCS.EXAMPLE.COM/Guide.PDF\" data-env=\"Prod\" data-tags=\"featured Core\" lang=\"EN-US\">DocLink</a>",
            "  <a href=\"http://internal.local/test.txt\" data-env=\"staging\" data-tags=\"beta\" lang=\"fr-CA\">TestLink</a>",
            "</div>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "m1=$(htmlq -t 'a[data-env=\"prod\" i]' -f /workspace/attrs.html)",
            "m2=$(htmlq -t 'a[href^=\"https://\" i][href$=\".pdf\" i]' -f /workspace/attrs.html)",
            "m3=$(htmlq -t 'a[data-tags~=\"core\" i][lang|=\"en\" i]' -f /workspace/attrs.html)",
            "m4=$(htmlq -t 'a[href*=\"GUIDE\" i]' -f /workspace/attrs.html)",
            "printf '%s|%s|%s|%s\\n' \"$m1\" \"$m2\" \"$m3\" \"$m4\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "DocLink|DocLink|DocLink|DocLink");
      },
    );
  });

  it("12_htmlq_root_scope_link_any_link_and_compound_not_pseudo_classes", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/links.html": [
            "<html data-root=\"yes\">",
            "  <body>",
            "    <a name=\"top\">AnchorWithoutHref</a>",
            "    <a href=\"mailto:ops@example.com\">MailLink</a>",
            "    <a href=\"/docs\">DocsLink</a>",
            "    <area href=\"/map-zone\" alt=\"Zone\">",
            "  </body>",
            "</html>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "rt=$(htmlq -a data-root ':root' -f /workspace/links.html)",
            "lnks=$(htmlq -a href ':any-link' -f /workspace/links.html | paste -sd',' -)",
            "web=$(htmlq -t 'a:link:not([href^=\"mailto:\"])' -f /workspace/links.html)",
            "printf 'root=%s|links=%s|web=%s\\n' \"$rt\" \"$lnks\" \"$web\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          "root=yes|links=mailto:ops@example.com,/docs,/map-zone|web=DocsLink",
        );
      },
    );
  });

  it("13_htmlq_ignore_whitespace_remove_nodes_and_output_file_options", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/article.html": [
            "<article>",
            "  <script>alert(1)</script>",
            "  <div class=\"ad\">Promo</div>",
            "  <h1>Title Line</h1>",
            "  <p>Paragraph Line</p>",
            "</article>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "htmlq -t -w -r script -r .ad -o /workspace/clean.txt 'article' -f /workspace/article.html",
            "grep -v '^$' /workspace/clean.txt | paste -sd'|' -",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "Title Line|Paragraph Line");
      },
    );
  });

  it("14_htmlq_html_to_markdown_and_mdq_end_to_end_scraping_pipeline", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/kb.html": [
            "<html><body>",
            "  <nav><a href=\"/nav\">Nav</a></nav>",
            "  <main>",
            "    <h1>Runbook</h1>",
            "    <h2>Database Failover</h2>",
            "    <p>Follow the <a href=\"https://kb.example.com/db\">DB Guide</a> carefully.</p>",
            "    <h2>Cache Flush</h2>",
            "    <p>Skip unless needed.</p>",
            "  </main>",
            "</body></html>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "htmlq -r nav 'main' -f /workspace/kb.html | html-to-markdown > /workspace/kb.md",
            "mdq -o plain '#{2} Database | [](*)' /workspace/kb.md",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "DB Guide");
      },
    );
  });

  it("15_mdq_section_range_selectors_regex_case_sensitive_and_anchors", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/spec.md": [
            "# Overview",
            "",
            "Intro text.",
            "",
            "## API v1",
            "",
            "Legacy.",
            "",
            "## API v2",
            "",
            "Current.",
            "",
            "#### API v3 Draft",
            "",
            "Future.",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "s1=$(mdq -o json '#{2,3} /^API v[0-9]+$/' /workspace/spec.md | jq -r '[.items[].section.title] | join(\",\")')",
            "s2=$(mdq -o json '# \"API v3 Draft\"' /workspace/spec.md | jq -r '.items[0].section.depth')",
            "printf 's1=%s|s2=%s\\n' \"$s1\" \"$s2\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "s1=API v1,API v2|s2=4");
      },
    );
  });

  it("16_mdq_regex_replacement_in_headings_paragraphs_lists_and_code_blocks", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/changelog.md": [
            "# v1.4.0 - Core",
            "",
            "Deploy to staging cluster.",
            "",
            "- TODO migrate schema",
            "",
            "```yaml",
            "host: localhost:8080",
            "```",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "h1=$(mdq -o plain '# !s/^v([0-9.]+) - (.*)$/Release $1 ($2)/' /workspace/changelog.md | head -n 1)",
            "p1=$(mdq -o plain 'P: !s/\\b(?P<env>staging|prod)\\b/[${env}]/' /workspace/changelog.md)",
            "l1=$(mdq -o plain -- '- !s/TODO/DONE/' /workspace/changelog.md)",
            "c1=$(mdq -o plain '```yaml !s/localhost:([0-9]+)/127.0.0.1:$1/' /workspace/changelog.md)",
            "printf '%s|%s|%s|%s\\n' \"$h1\" \"$p1\" \"$l1\" \"$c1\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          "Release 1.4.0 (Core)|Deploy to [staging] cluster.|DONE migrate schema|host: 127.0.0.1:8080",
        );
      },
    );
  });

  it("17_mdq_image_and_link_selectors_with_link_format_and_link_pos", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/media.md": [
            "# Docs",
            "",
            "See [Architecture](https://example.com/arch) and ![Topology Diagram](https://example.com/topo.png).",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "img=$(mdq -o json '![Topology](*)' /workspace/media.md | jq -c '.items[0].image')",
            "lnk_in=$(mdq -l inline '[Architecture](*)' /workspace/media.md)",
            "lnk_ref=$(mdq -l never-inline '[Architecture](*)' /workspace/media.md | tr '\\n' ' ' | sed 's/  */ /g; s/ $//')",
            "printf 'img=%s|in=%s|ref=%s\\n' \"$img\" \"$lnk_in\" \"$lnk_ref\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          'img={"alt":"Topology Diagram","url":"https://example.com/topo.png"}|in=[Architecture](https://example.com/arch)|ref=[Architecture][1] [1]: https://example.com/arch',
        );
      },
    );
  });

  it("18_mdq_front_matter_yaml_toml_and_html_block_selectors_with_json_output", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/post.md": [
            "---",
            "title: Deep Parity",
            "draft: false",
            "---",
            "",
            "# Heading",
            "",
            "<div class=\"callout\">Warning</div>",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "fm=$(mdq -o json '+++yaml' /workspace/post.md | jq -c '.items[0].front_matter')",
            "ht=$(mdq -o json '</> /callout/' /workspace/post.md | jq -c '.items[0].html')",
            "printf 'fm=%s|ht=%s\\n' \"$fm\" \"$ht\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          'fm={"body":"title: Deep Parity\\ndraft: false","variant":"yaml"}|ht={"value":"<div class=\\"callout\\">Warning</div>"}',
        );
      },
    );
  });

  it("19_mdq_table_selector_column_and_row_filtering_with_cell_regex_replacement", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/table.md": [
            "| Service | Region | Latency |",
            "| :--- | :---: | ---: |",
            "| auth | us-east | 12ms |",
            "| cache | eu-west | 4ms |",
            "| batch | ap-south | 250s |",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          "mdq -o json ':-: /^(Service|Latency)$/ :-: !s/([0-9]+)ms/$1 ms/' /workspace/table.md | jq -c '.items[0].table'",
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          '{"alignments":["left","right"],"rows":[["Service","Latency"],["auth","12 ms"],["cache","4 ms"]]}',
        );
      },
    );
  });

  it("20_mdq_task_lists_ordered_lists_blockquotes_quiet_mode_and_wrap_width", async () => {
    await withE2EHarness(
      {
        files: {
          "/workspace/tasks.md": [
            "- [ ] Pending migration",
            "- [x] Completed backup",
            "- Regular bullet",
            "",
            "1. First step",
            "2. Second step",
            "",
            "> Important note about safety.",
            "",
          ].join("\n"),
        },
      },
      async (h) => {
        const r = await h.exec(
          [
            "open_t=$(mdq -o plain -- '- [ ]' /workspace/tasks.md)",
            "done_t=$(mdq -o plain -- '- [x]' /workspace/tasks.md)",
            "any_t=$(mdq -o plain --no-br -- '- [?]' /workspace/tasks.md | paste -sd',' -)",
            "ord=$(mdq -o plain --no-br '1.' /workspace/tasks.md | paste -sd',' -)",
            "qt=$(mdq -o plain '> safety' /workspace/tasks.md)",
            "mdq -q -- '- [x] backup' /workspace/tasks.md && q_hit=0 || q_hit=$?",
            "mdq -q -- '- [x] nonexistent' /workspace/tasks.md && q_miss=0 || q_miss=$?",
            "printf '%s|%s|%s|%s|%s|%s|%s\\n' \"$open_t\" \"$done_t\" \"$any_t\" \"$ord\" \"$qt\" \"$q_hit\" \"$q_miss\"",
          ].join("\n"),
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          "Pending migration|Completed backup|Pending migration,Completed backup|First step,Second step|Important note about safety.|0|1",
        );
      },
    );
  });
});
