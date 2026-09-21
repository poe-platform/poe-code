use poe_agent_rust::html_markdown::convert;
fn check(html: &str, markdown: &str) {
    assert_eq!(
        convert(&html.encode_utf16().collect::<Vec<_>>()).unwrap(),
        markdown.encode_utf16().collect::<Vec<_>>()
    );
}
#[test]
fn structural_html_to_markdown_preserves_blocks_entities_and_code() {
    check(
        "<html><body><h1>Example</h1><p>Hello <strong>world</strong>.</p></body></html>",
        "# Example\n\nHello **world**.",
    );
    check("<p>A &amp; B &lt; C &#x1f30d;</p>", "A & B < C 🌍");
    check(
        "<p><em>italic</em> <a href='/a(b)' title='title'>link</a></p>",
        "_italic_ [link](/a\\(b\\) \"title\")",
    );
    check(
        "<blockquote><p>one</p><p>two</p></blockquote>",
        "> one\n> \n> two",
    );
    check("<ul><li>one</li><li>two</li></ul>", "*   one\n*   two");
    check(
        "<pre><code class='language-rust'>let x = 1;\n</code></pre>",
        "```rust\nlet x = 1;\n```",
    );
}
