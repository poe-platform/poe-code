# diagram-renderer-rust

The existing Safe Bash Mermaid and Graphviz parsers and layouts, extracted for reuse by document exports. No external process, browser, or third-party Rust dependency is required.

`render_mermaid(source, limit)` and `render_graphviz(source, limit)` return a `RenderedDiagram`: a `document_ast_rust::vector::Scene` and SVG serialized from that same scene. Layout runs once; the screen, DOCX and PDF consumers receive the same paths and text positions. The scene uses points with a top-left origin; Mermaid CSS pixels are converted at 0.75 points per pixel. Text remains text, and shape geometry remains editable. Consumers can also call `svg::to_svg(&scene).await` for their own structured scenes.

Mermaid supports the native engine's flowchart, sequence, state, class, ER, pie, Gantt, git graph, mindmap, timeline and journey families. DOT uses the native `dot` layout, including clusters, record fields, node shapes, edge labels and endpoint labels. Unknown Mermaid families and diagram hyperlinks return explicit errors. Soft shadows use translucent vector layers. This package retains the native engines' supported syntax; it is not a full replacement for every upstream Mermaid or Graphviz feature.

Safe Bash keeps its command-level argument, filesystem and image-encoding behavior through `graphviz::render_legacy` and the extracted Mermaid layout APIs. `render_dot_svg` retains its API and uses the same shared defaults. The new document APIs use the canonical scene serializer.

Typography and palettes live in the Rust `theme` module, shared by Mermaid and
Graphviz. Both default to the existing Mermaid sans-serif appearance, muted
borders and connectors, and rounded boxes. Explicit DOT shapes, fonts, colors,
and nested defaults retain precedence. `render_mermaid_with_config` and
`render_graphviz_with_config` accept `theme::Config`, parsed from Safe Bash's
existing configuration JSON. Host tokens are defaults; authored configuration
wins. Typography is expressed in CSS pixels and converted to points for DOT.
The theme changes the scene before serialization, so SVG and document consumers
receive identical style choices. Font families still need to be available to the
consumer; a PDF writer may reject unsupported fonts.

Input is capped at 1 MiB and SVG output at 16 MiB, additionally bounded by the supplied byte limit. DOT retains its 256-node, 2048-edge and layout-work limits. The shared vector validator checks scene dimensions and geometry before SVG publication.

Run `cargo test --manifest-path packages/diagram-renderer-rust/Cargo.toml --locked --offline` from the repository root. Integration tests cover every supported Mermaid family, editable DOT content, viewport units, canonical SVG identity, endpoint labels, malformed input and bounded admission. Shell compatibility tests remain in `safe-bash-rust`.
