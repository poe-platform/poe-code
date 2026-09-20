use toolcraft_design_rust::{
    data::{DataEnvironment, DataHost, Graph, Node},
    template::{self, Partials, RenderOptions},
};
struct NoHost;
impl DataHost for NoHost {}
impl Partials for NoHost {
    fn has(&mut self, _: &[u16]) -> Result<bool, template::Error> {
        Ok(false)
    }
    fn get(&mut self, _: &[u16]) -> Result<Vec<u16>, template::Error> {
        panic!("No partial requested")
    }
}
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn owned_data_environment_renders_scopes_without_host_lookups() {
    let graph = Graph {
        root: 1,
        nodes: vec![
            Node::Undefined,
            Node::Object(vec![(u("repo"), 2), (u("items"), 3)]),
            Node::String(u("parent")),
            Node::Array {
                properties: vec![],
                items: vec![4, 4],
            },
            Node::Object(vec![(u("name"), 5)]),
            Node::String(u("child")),
        ],
    };
    let mut host = NoHost;
    let mut environment = DataEnvironment::new(&graph, &mut host).unwrap();
    let actual = template::render(
        &u("{{#items}}[{{name}}/{{repo}}]{{/items}}"),
        0,
        &mut environment,
        RenderOptions::default(),
    )
    .unwrap();
    assert_eq!(actual, u("[child/parent][child/parent]"));
}
#[test]
fn malformed_snapshot_references_reject_before_evaluation() {
    let graph = Graph {
        root: 1,
        nodes: vec![Node::Undefined, Node::Object(vec![(u("name"), usize::MAX)])],
    };
    assert!(DataEnvironment::new(&graph, &mut NoHost).is_err());
}
#[test]
fn owned_array_coercion_retains_js_cycle_and_null_rules() {
    let graph = Graph {
        root: 1,
        nodes: vec![
            Node::Undefined,
            Node::Object(vec![(u("items"), 2)]),
            Node::Array {
                properties: vec![],
                items: vec![3, 0, 4, 2],
            },
            Node::String(u("one")),
            Node::Null,
        ],
    };
    let mut host = NoHost;
    let mut env = DataEnvironment::new(&graph, &mut host).unwrap();
    assert_eq!(
        template::render(&u("{{items}}"), 0, &mut env, RenderOptions::default()).unwrap(),
        u("one,,,")
    );
}
#[test]
fn snapshot_decoder_rejects_truncation_overcounts_invalid_tags_and_references() {
    let valid = [0, 0, 0, 0, 1, 0, 0, 0, 0];
    assert!(toolcraft_design_rust::data::decode(&valid).is_ok());
    for end in 0..valid.len() {
        assert!(toolcraft_design_rust::data::decode(&valid[..end]).is_err());
    }
    let mut extra = valid.to_vec();
    extra.push(0);
    assert!(toolcraft_design_rust::data::decode(&extra).is_err());
    let mut bad = valid;
    bad[8] = 255;
    assert!(toolcraft_design_rust::data::decode(&bad).is_err());
    let mut bad = valid;
    bad[4] = 255;
    assert!(toolcraft_design_rust::data::decode(&bad).is_err());
    let mut bad = valid;
    bad[0] = 255;
    assert!(toolcraft_design_rust::data::decode(&bad).is_err());
}
