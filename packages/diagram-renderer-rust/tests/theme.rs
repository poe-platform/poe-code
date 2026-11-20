use diagram_renderer_rust::{render_graphviz, render_mermaid};
use document_ast_rust::vector::{Node, NodeKind};

fn text_style(nodes: &[Node], label: &str, scale: f64) -> Option<(String, f64, [u8; 4])> {
    for node in nodes {
        let scale = scale * node.transform[0];
        match &node.kind {
            NodeKind::Group(children) => {
                if let Some(style) = text_style(children, label, scale) { return Some(style); }
            }
            NodeKind::Text(run) if run.text == label => return Some((run.font_family.clone(), run.font_size * scale, run.color)),
            _ => {}
        }
    }
    None
}

#[test]
fn default_graphviz_and_mermaid_share_physical_typography() {
    let mermaid = render_mermaid("flowchart LR\n A[Start] --> B[Finish]", 65536).unwrap();
    let graphviz = render_graphviz("digraph {a [label=Start];b [label=Finish];a->b}", 65536).unwrap();
    assert_eq!(text_style(&graphviz.scene.nodes, "Start", 1.), text_style(&mermaid.scene.nodes, "Start", 1.));
}

fn config(source: &str) -> diagram_renderer_rust::theme::Config {
    let value = mcp_protocol_rust::json::parse(source.as_bytes(), Default::default()).unwrap();
    diagram_renderer_rust::theme::Config::parse(&value, false).unwrap()
}

#[test]
fn host_typography_and_palette_reach_both_native_scenes() {
    let config = config(r##"{"theme":{"light":{"fontFamily":"JetBrains Mono","fontSize":20,"text":"#123456","border":"#aabbcc","surface":"#eeeedd","edge":"#345678"}}}"##);
    for output in [
        diagram_renderer_rust::render_mermaid_with_config("flowchart LR\n A[Start] --> B[Finish]", 65536, &config).unwrap(),
        diagram_renderer_rust::render_graphviz_with_config("digraph {a [label=Start];b [label=Finish];a->b}", 65536, &config).unwrap(),
    ] {
        assert_eq!(text_style(&output.scene.nodes, "Start", 1.), Some(("JetBrains Mono".into(), 15., [18,52,86,255])));
        for color in ["#123456", "#aabbcc", "#eeeedd", "#345678"] { assert!(output.svg.contains(color), "missing {color}"); }
    }
}

#[test]
fn source_styles_override_host_defaults_and_do_not_leak_to_other_renders() {
    let config = config(r##"{"theme":{"light":{"fontFamily":"JetBrains Mono","fontSize":20,"text":"#123456"}}}"##);
    let graph = diagram_renderer_rust::render_graphviz_with_config(r#"digraph {a [label=Start,fontname="Times New Roman",fontsize=18,fontcolor=red,shape=ellipse];a->b}"#,65536,&config).unwrap();
    assert_eq!(text_style(&graph.scene.nodes,"Start",1.),Some(("Times New Roman".into(),18.,[255,0,0,255])));
    let source="---\nconfig:\n  theme:\n    light:\n      fontFamily: Arial\n      fontSize: 24\n      text: '#ff0000'\n---\nflowchart LR\n A[Start] --> B";
    let mermaid=diagram_renderer_rust::render_mermaid_with_config(source,65536,&config).unwrap();
    assert_eq!(text_style(&mermaid.scene.nodes,"Start",1.),Some(("Arial".into(),18.,[255,0,0,255])));
    let plain=render_graphviz("digraph {Start->Finish}",65536).unwrap();
    assert_eq!(text_style(&plain.scene.nodes,"Start",1.).unwrap().1,9.75);
}

#[test]
fn native_dot_svg_uses_shared_defaults_and_preserves_callers_overrides() {
    let svg=String::from_utf8(diagram_renderer_rust::render_dot_svg("digraph {a->b}",&[],&[],&[]).unwrap()).unwrap();
    assert!(svg.contains("Inter,"));assert!(svg.contains("#cbd5e1"));assert!(svg.contains("#64748b"));assert!(svg.contains("font-size=\"9.75\""));
    let svg=String::from_utf8(diagram_renderer_rust::render_dot_svg("digraph {a->b}",&[],&[("fontname","Courier New"),("fontsize","22")],&[]).unwrap()).unwrap();
    assert!(svg.contains("font-family=\"Courier New\" font-size=\"22\""));
}

#[test]
fn invalid_theme_values_fail_before_a_scene_is_returned() {
    for value in [r#"{"theme":{"light":{"fontSize":0}}}"#,r#"{"theme":{"light":{"text":"invalid-paint"}}}"#,r#"{"theme":{"light":{"unknown":true}}}"#] {
        let config=config(value);
        assert!(diagram_renderer_rust::render_graphviz_with_config("digraph {a->b}",65536,&config).is_err());
        assert!(diagram_renderer_rust::render_mermaid_with_config("flowchart LR\n A-->B",65536,&config).is_err());
    }
}
