mod support;
use config_extends_rust::{
    Layer, discover,
    resolve::{BaseLayer, ChainLayer, DocumentLayer, Host, Options, resolve},
};
use config_mutations_rust::value::Value;
use std::collections::HashMap;
use support::complete;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
struct Memory {
    files: HashMap<Vec<u16>, Vec<u16>>,
    reads: Vec<Vec<u16>>,
    canonical: HashMap<Vec<u16>, Vec<u16>>,
}
impl discover::Host for Memory {
    type Error = &'static str;
    fn join(&mut self, directory: &[u16], file: &[u16]) -> Vec<u16> {
        let mut path = directory.to_vec();
        path.push(47);
        path.extend(file);
        path
    }
    fn contains(&mut self, directory: &[u16], file: &[u16]) -> bool {
        let mut root = self.resolve(directory);
        root.push(47);
        self.resolve(file).starts_with(&root)
    }
    async fn read(&mut self, path: &[u16]) -> Result<Option<Vec<u16>>, Self::Error> {
        self.reads.push(path.to_vec());
        Ok(self.files.get(path).cloned())
    }
}
impl Host for Memory {
    fn resolve(&mut self, path: &[u16]) -> Vec<u16> {
        let text = String::from_utf16(path).unwrap();
        let mut parts = vec![];
        for part in text.split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    parts.pop();
                }
                _ => parts.push(part),
            }
        }
        u(&format!("/{}", parts.join("/")))
    }
    fn dirname(&mut self, path: &[u16]) -> Vec<u16> {
        let index = path.iter().rposition(|unit| *unit == 47).unwrap_or(0);
        path[..index].to_vec()
    }
    fn basename(&mut self, path: &[u16]) -> Vec<u16> {
        let start = path
            .iter()
            .rposition(|unit| *unit == 47)
            .map_or(0, |i| i + 1);
        let name = &path[start..];
        let end = name
            .iter()
            .rposition(|unit| *unit == 46)
            .unwrap_or(name.len());
        name[..end].to_vec()
    }
    fn extension(&mut self, path: &[u16]) -> Vec<u16> {
        path.iter()
            .rposition(|unit| *unit == 46)
            .map_or(vec![], |i| path[i..].to_vec())
    }
    fn is_absolute(&mut self, path: &[u16]) -> bool {
        path.first() == Some(&47)
    }
}
fn memory(files: &[(&str, &str)]) -> Memory {
    Memory {
        files: files
            .iter()
            .map(|(path, text)| (u(path), u(text)))
            .collect(),
        reads: vec![],
        canonical: HashMap::new(),
    }
}

impl config_extends_rust::prompt_document::Host for Memory {
    async fn realpath(&mut self, path: &[u16]) -> Result<Option<Vec<u16>>, Self::Error> {
        Ok(Some(
            self.canonical
                .get(path)
                .cloned()
                .unwrap_or_else(|| self.resolve(path)),
        ))
    }
}

#[test]
fn rooted_prompt_documents_use_overlays_and_return_template_rendered_prompt_and_metadata() {
    use config_extends_rust::prompt_document::{BaseDocument, Input, resolve_prompt_document};
    use toolcraft_design_rust::data::{Graph, Node};
    let mut fs = memory(&[]);
    let variables = Graph {
        root: 0,
        nodes: vec![Node::Object(vec![(u("name"), 1)]), Node::String(u("Rust"))],
    };
    let mut input = Input::new(u("/project"), u("review.md"));
    input.content = Some(u("---\nextends: true\ntitle: Demo\n---\nDoc({{yield}})"));
    input.variables = Some(&variables);
    input.base_documents.push(BaseDocument {
        file_path: u("/bases/review.md"),
        content: u("Base {{name}}"),
    });
    let result = complete(resolve_prompt_document(&input, &mut fs)).unwrap();
    assert_eq!(result.template, u("Doc(Base {{name}})"));
    assert_eq!(result.prompt, u("Doc(Base Rust)"));
    assert_eq!(result.metadata.get("title"), Some(&text("Demo")));
    assert!(result.metadata.get("prompt").is_none());
    assert!(fs.reads.is_empty());
}
#[test]
fn prompt_document_lexical_and_symlink_escapes_are_rejected_and_roots_can_resolve() {
    use config_extends_rust::prompt_document::{Input, resolve_prompt_document};
    let mut fs = memory(&[("/project/review.md", "Body")]);
    let input = Input::new(u("/project"), u("../secret.md"));
    assert_eq!(
        complete(resolve_prompt_document(&input, &mut fs)).unwrap_err(),
        discover::Error::Policy(u("Prompt document path must remain inside cwd: /secret.md"))
    );
    fs.canonical
        .insert(u("/project/review.md"), u("/elsewhere/review.md"));
    let input = Input::new(u("/project"), u("review.md"));
    assert_eq!(
        complete(resolve_prompt_document(&input, &mut fs)).unwrap_err(),
        discover::Error::Policy(u(
            "Prompt document path escapes configured root: /project/review.md"
        ))
    );
    assert!(fs.reads.is_empty());
    fs.canonical.insert(u("/project"), u("/private/project"));
    fs.canonical
        .insert(u("/project/review.md"), u("/private/project/review.md"));
    assert_eq!(
        complete(resolve_prompt_document(&input, &mut fs))
            .unwrap()
            .prompt,
        u("Body")
    );
}
#[test]
fn optional_missing_prompt_documents_extend_bases_and_relative_base_paths_reject() {
    use config_extends_rust::prompt_document::{Input, resolve_prompt_document};
    let mut fs = memory(&[("/bases/review.md", "Base")]);
    let mut input = Input::new(u("/project"), u("review.md"));
    input.optional = true;
    input.base_paths.push(u("/bases"));
    assert_eq!(
        complete(resolve_prompt_document(&input, &mut fs))
            .unwrap()
            .prompt,
        u("Base")
    );
    input.base_paths[0] = u("relative");
    assert_eq!(
        complete(resolve_prompt_document(&input, &mut fs)).unwrap_err(),
        discover::Error::Policy(u("Prompt document base paths must be absolute: relative"))
    );
}
fn document(content: &str) -> ChainLayer {
    ChainLayer::Document(DocumentLayer {
        source: u("document"),
        file_path: u("/project/review.md"),
        content: u(content),
        base_name: None,
    })
}
fn base(path: &str, source: &str) -> ChainLayer {
    ChainLayer::Base(BaseLayer {
        path: u(path),
        source: u(source),
    })
}
#[test]
fn owned_resolution_loads_nested_bases_composes_prompts_and_preserves_priority() {
    let mut fs = memory(&[
        (
            "/first/review.md",
            "---\nextends: true\ncount: 2\n---\nFirst({{yield}})",
        ),
        (
            "/second/review.yaml",
            "prompt: Second\ncount: 3\nextra: inherited",
        ),
    ]);
    let chain = [
        ChainLayer::Data(Layer {
            source: u("cli"),
            data: Value::Object(vec![(u("count"), Value::Number(1.0))]),
        }),
        document("---\nextends: true\n---\nDoc({{yield}})"),
        base("/first", "first"),
        base("/second", "second"),
    ];
    let result = complete(resolve(&chain, &Options::default(), &mut fs)).unwrap();
    assert_eq!(
        result.data.get("prompt"),
        Some(&Value::String(u("Doc(First(Second))")))
    );
    assert_eq!(result.data.get("count"), Some(&Value::Number(1.0)));
    assert!(result.sources.contains(&(u("count"), u("cli"))));
    assert_eq!(
        result.chain,
        [
            "/project/review.md",
            "/first/review.md",
            "/second/review.yaml"
        ]
        .map(u)
    );
}
#[test]
fn optional_autoextend_can_miss_but_explicit_false_never_reads_bases() {
    let mut fs = memory(&[]);
    let options = Options {
        auto_extend: true,
        ..Options::default()
    };
    assert!(
        complete(resolve(
            &[document("Body"), base("/missing", "base")],
            &options,
            &mut fs
        ))
        .is_ok()
    );
    assert_eq!(fs.reads.len(), 4);
    fs.reads.clear();
    assert!(
        complete(resolve(
            &[
                document("---\nextends: false\n---\nBody"),
                base("/missing", "base")
            ],
            &options,
            &mut fs
        ))
        .is_ok()
    );
    assert!(fs.reads.is_empty());
}
#[test]
fn relative_paths_cycles_and_maximum_depth_are_rejected_before_extra_reads() {
    let mut fs = memory(&[
        ("/project/base.yaml", "extends: ./review.md"),
        ("/project/review.md", "---\nextends: ./base.yaml\n---\nBody"),
    ]);
    let result = complete(resolve(
        &[document("---\nextends: ./base.yaml\n---\nBody")],
        &Options::default(),
        &mut fs,
    ))
    .unwrap_err();
    assert!(
        matches!(result,discover::Error::Policy(message) if String::from_utf16(&message).unwrap().starts_with("Circular extends detected."))
    );
    let mut fs = memory(&[]);
    for index in 0..6 {
        fs.files.insert(
            u(&format!("/project/{index}.yaml")),
            u(&format!("extends: ./{}.yaml", index + 1)),
        );
    }
    let result = complete(resolve(
        &[document("---\nextends: ./0.yaml\n---\nBody")],
        &Options::default(),
        &mut fs,
    ))
    .unwrap_err();
    assert_eq!(
        result,
        discover::Error::Policy(u("Maximum extends depth exceeded (5)."))
    );
    assert_eq!(fs.reads.len(), 5);
}
#[test]
fn partials_expand_in_dfs_order_and_can_introduce_yield_composition() {
    let mut fs = memory(&[
        ("/project/wrap.md", "Hello {{> nested}} {{yield}}"),
        ("/project/nested.md", "nested"),
        ("/bases/review.yaml", "prompt: Base"),
    ]);
    let result = complete(resolve(
        &[
            document("---\nextends: true\n---\n{{> wrap}}"),
            base("/bases", "base"),
        ],
        &Options::default(),
        &mut fs,
    ))
    .unwrap();
    assert_eq!(
        result.data.get("prompt"),
        Some(&Value::String(u("Hello nested Base")))
    );
    assert_eq!(
        result.chain,
        [
            "/project/review.md",
            "/bases/review.yaml",
            "/project/wrap.md",
            "/project/nested.md"
        ]
        .map(u)
    );
}
#[test]
fn empty_document_prompt_inherits_base_provenance_and_chain_requires_one_document() {
    let mut fs = memory(&[("/bases/review.yaml", "prompt: inherited")]);
    let result = complete(resolve(
        &[
            document("---\nextends: true\n---\n"),
            base("/bases", "base"),
        ],
        &Options::default(),
        &mut fs,
    ))
    .unwrap();
    assert!(result.sources.contains(&(u("prompt"), u("base"))));
    assert_eq!(
        complete(resolve(&[], &Options::default(), &mut fs)).unwrap_err(),
        discover::Error::Policy(u("Exactly one document layer is required, received 0."))
    );
}

#[test]
fn template_rendering_uses_the_owned_graph_and_validates_missing_variables() {
    use toolcraft_design_rust::data::{Graph, Node};
    let graph = Graph {
        root: 0,
        nodes: vec![
            Node::Object(vec![(u("name"), 1)]),
            Node::String(u("<Rust>")),
        ],
    };
    let mut fs = memory(&[]);
    let result = complete(resolve(
        &[document("Hello {{name}}")],
        &Options {
            view: Some(&graph),
            validate: true,
            ..Options::default()
        },
        &mut fs,
    ))
    .unwrap();
    assert_eq!(
        result.data.get("prompt"),
        Some(&Value::String(u("Hello <Rust>")))
    );
    assert!(
        complete(resolve(
            &[document("Hello {{missing}}")],
            &Options {
                validate: true,
                ..Options::default()
            },
            &mut fs
        ))
        .is_err()
    );
}

fn obj(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (u(key), value))
            .collect(),
    )
}
fn text(value: &str) -> Value {
    Value::String(u(value))
}
fn json(value: &Value) -> mcp_protocol_rust::json::Value {
    use mcp_protocol_rust::json::Value as J;
    match value {
        Value::Null => J::Null,
        Value::Bool(value) => J::Bool(*value),
        Value::Number(value) => J::Number(*value),
        Value::String(value) => J::String(value.clone()),
        Value::Array(items) => J::Array(items.iter().map(json).collect()),
        Value::Object(fields) => J::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), json(value)))
                .collect(),
        ),
        _ => panic!("JSON-only oracle fixtures"),
    }
}
fn chain_value(chain: &[ChainLayer]) -> Value {
    Value::Array(
        chain
            .iter()
            .map(|layer| match layer {
                ChainLayer::Data(layer) => obj(vec![
                    ("source", Value::String(layer.source.clone())),
                    ("data", layer.data.clone()),
                ]),
                ChainLayer::Document(layer) => obj(vec![
                    ("source", Value::String(layer.source.clone())),
                    ("filePath", Value::String(layer.file_path.clone())),
                    ("content", Value::String(layer.content.clone())),
                ]),
                ChainLayer::Base(layer) => obj(vec![
                    ("source", Value::String(layer.source.clone())),
                    ("path", Value::String(layer.path.clone())),
                ]),
            })
            .collect(),
    )
}
#[test]
fn generated_resolution_cases_match_current_sdk_including_reads_and_errors() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    use toolcraft_design_rust::data::{Graph, Node};
    let graph = Graph {
        root: 0,
        nodes: vec![Node::Object(vec![(u("name"), 1)]), Node::String(u("World"))],
    };
    let mut cases = vec![];
    let mut expected = vec![];
    for seed in 0..64 {
        let extending = if seed & 1 == 0 { "extends: true\n" } else { "" };
        let body = if seed & 2 == 0 {
            "{{> wrap}}"
        } else {
            "Doc {{name}}"
        };
        let document_content = format!("---\n{extending}count: 2\n---\n{body}");
        let base_content = if seed & 4 == 0 {
            "extends: true\nprompt: First({{yield}})\nextra: base"
        } else {
            "prompt: Base {{name}}\nextra: base"
        };
        let partial_content = if seed & 8 == 0 {
            "Hello {{> nested}} {{yield}}"
        } else {
            "Hello {{name}}"
        };
        let mut fs = memory(&[
            ("/first/review.yaml", base_content),
            ("/second/review.yaml", "prompt: Second\nextra: second"),
            ("/project/wrap.md", partial_content),
            ("/project/nested.md", "nested"),
        ]);
        let chain = [
            ChainLayer::Data(Layer {
                source: u("cli"),
                data: obj(vec![("count", Value::Number(1.0))]),
            }),
            document(&document_content),
            base("/first", "first"),
            base("/second", "second"),
            ChainLayer::Data(Layer {
                source: u("fallback"),
                data: obj(vec![("fallback", Value::Bool(true))]),
            }),
        ];
        let options = Options {
            auto_extend: seed & 16 != 0,
            validate: seed & 32 != 0,
            view: (seed & 32 != 0).then_some(&graph),
        };
        let files = Value::Object(
            fs.files
                .iter()
                .map(|(key, value)| (key.clone(), Value::String(value.clone())))
                .collect(),
        );
        cases.push(obj(vec![
            ("chain", chain_value(&chain)),
            ("files", files),
            (
                "options",
                obj(vec![
                    ("autoExtend", Value::Bool(options.auto_extend)),
                    ("validate", Value::Bool(options.validate)),
                    (
                        "view",
                        if options.view.is_some() {
                            obj(vec![("name", text("World"))])
                        } else {
                            Value::Null
                        },
                    ),
                ]),
            ),
        ]));
        let result = match complete(resolve(&chain, &options, &mut fs)) {
            Ok(result) => obj(vec![
                ("data", result.data),
                (
                    "sources",
                    Value::Object(
                        result
                            .sources
                            .into_iter()
                            .map(|(key, source)| (key, Value::String(source)))
                            .collect(),
                    ),
                ),
                (
                    "chain",
                    Value::Array(result.chain.into_iter().map(Value::String).collect()),
                ),
            ]),
            Err(discover::Error::Policy(message)) => obj(vec![("error", Value::String(message))]),
            Err(discover::Error::Host(error)) => panic!("Unexpected host error {error}"),
        };
        expected.push(obj(vec![
            ("result", result),
            (
                "reads",
                Value::Array(fs.reads.into_iter().map(Value::String).collect()),
            ),
        ]));
    }
    let input =
        mcp_protocol_rust::json::stringify(&json(&obj(vec![("cases", Value::Array(cases))])));
    let script = "import {resolve} from '../config-extends/dist/resolve.js';let input='';for await(const chunk of process.stdin)input+=chunk;const results=[];for(const {chain,files,options}of JSON.parse(input).cases){const reads=[];const fs={async readFile(path){reads.push(path);if(Object.hasOwn(files,path))return files[path];throw Object.assign(new Error('missing'),{code:'ENOENT'})}};if(options.view===null)delete options.view;let result;try{result=await resolve(chain,{...options,fs})}catch(error){result={error:error.message}}results.push({result,reads})}console.log(JSON.stringify({cases:results}));";
    let mut child = Command::new("node")
        .args(["--input-type=module", "-e", script])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let actual =
        mcp_protocol_rust::json::parse(&output.stdout, mcp_protocol_rust::json::Limits::default())
            .unwrap();
    let expected = json(&obj(vec![("cases", Value::Array(expected))]));
    assert_eq!(actual, expected);
}

#[test]
fn generated_rooted_overlay_optional_and_template_cases_match_sdk_results_and_reads() {
    use config_extends_rust::prompt_document::{BaseDocument, Input, resolve_prompt_document};
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    use toolcraft_design_rust::data::{Graph, Node};
    let graph = Graph {
        root: 0,
        nodes: vec![Node::Object(vec![(u("name"), 1)]), Node::String(u("World"))],
    };
    let mut cases = vec![];
    let mut expected = vec![];
    for seed in 0..32 {
        let mut fs = memory(&[]);
        let mut input = Input::new(u("/project"), u("review.md"));
        input.optional = true;
        if seed & 1 == 0 {
            input.content = Some(u("---\nextends: true\ncount: 2\n---\nDoc({{yield}})"));
        }
        input.variables = (seed & 2 == 0).then_some(&graph);
        input.validate = Some(seed & 4 == 0);
        if seed & 8 == 0 {
            input.base_paths.push(u("/first"));
            fs.files.insert(
                u("/first/review.yaml"),
                u("extends: true\nprompt: First({{yield}})\ncount: 3"),
            );
        }
        input.base_documents.push(BaseDocument {
            file_path: u("/bases/review.md"),
            content: u("Base {{name}}"),
        });
        if seed & 16 == 0 {
            input.base_documents.push(BaseDocument {
                file_path: u("/bases/review.md"),
                content: u("Latest {{name}}"),
            });
        }
        let files = Value::Object(
            fs.files
                .iter()
                .map(|(key, value)| (key.clone(), Value::String(value.clone())))
                .collect(),
        );
        let mut fields = vec![
            ("cwd", text("/project")),
            ("filePath", text("review.md")),
            ("optional", Value::Bool(true)),
            ("validate", Value::Bool(input.validate.unwrap())),
            (
                "basePaths",
                Value::Array(
                    input
                        .base_paths
                        .iter()
                        .cloned()
                        .map(Value::String)
                        .collect(),
                ),
            ),
            (
                "baseDocuments",
                Value::Array(
                    input
                        .base_documents
                        .iter()
                        .map(|document| {
                            obj(vec![
                                ("filePath", Value::String(document.file_path.clone())),
                                ("content", Value::String(document.content.clone())),
                            ])
                        })
                        .collect(),
                ),
            ),
        ];
        if let Some(content) = &input.content {
            fields.push(("content", Value::String(content.clone())));
        }
        if input.variables.is_some() {
            fields.push(("variables", obj(vec![("name", text("World"))])));
        }
        cases.push(obj(vec![("input", obj(fields)), ("files", files)]));
        let result = match complete(resolve_prompt_document(&input, &mut fs)) {
            Ok(result) => obj(vec![
                ("template", Value::String(result.template)),
                ("prompt", Value::String(result.prompt)),
                ("metadata", result.metadata),
                (
                    "sources",
                    Value::Object(
                        result
                            .sources
                            .into_iter()
                            .map(|(key, source)| (key, Value::String(source)))
                            .collect(),
                    ),
                ),
                ("source", Value::String(result.source)),
                (
                    "chain",
                    Value::Array(result.chain.into_iter().map(Value::String).collect()),
                ),
            ]),
            Err(discover::Error::Policy(message)) => obj(vec![("error", Value::String(message))]),
            Err(discover::Error::Host(error)) => panic!("Unexpected host error {error}"),
        };
        expected.push(obj(vec![
            ("result", result),
            (
                "reads",
                Value::Array(fs.reads.into_iter().map(Value::String).collect()),
            ),
        ]));
    }
    let script = "import path from 'node:path';import {resolvePromptDocument} from '../config-extends/dist/prompt-document.js';let input='';for await(const chunk of process.stdin)input+=chunk;const results=[];for(const {input:options,files}of JSON.parse(input).cases){const reads=[];const fs={async realpath(file){return path.resolve(file)},async readFile(file){reads.push(file);if(Object.hasOwn(files,file))return files[file];throw Object.assign(new Error('missing'),{code:'ENOENT'})}};let result;try{result=await resolvePromptDocument({...options,fs})}catch(error){result={error:error.message}}results.push({result,reads})}console.log(JSON.stringify({cases:results}));";
    let mut child = Command::new("node")
        .args(["--input-type=module", "-e", script])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(
            mcp_protocol_rust::json::stringify(&json(&obj(vec![("cases", Value::Array(cases))])))
                .as_bytes(),
        )
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        mcp_protocol_rust::json::parse(&output.stdout, mcp_protocol_rust::json::Limits::default())
            .unwrap(),
        json(&obj(vec![("cases", Value::Array(expected))]))
    );
}

#[test]
fn prepared_resolution_preserves_lower_object_candidates_and_document_position() {
    use config_extends_rust::resolve::prepare;
    let mut fs = memory(&[(
        "/bases/job.yaml",
        "settings:\n  inherited: true\nprompt: Base",
    )]);
    let chain = vec![
        ChainLayer::Data(Layer {
            source: u("override"),
            data: Value::Object(vec![(
                u("settings"),
                Value::Object(vec![(u("own"), Value::Bool(true))]),
            )]),
        }),
        ChainLayer::Document(DocumentLayer {
            source: u("document"),
            file_path: u("/work/job.yaml"),
            content: u("extends: true\nsettings: scalar"),
            base_name: None,
        }),
        ChainLayer::Base(BaseLayer {
            source: u("base"),
            path: u("/bases"),
        }),
    ];
    let prepared = complete(prepare(&chain, &Options::default(), &mut fs)).unwrap();
    assert_eq!(prepared.document_index, 1);
    assert_eq!(prepared.layers.len(), 2);
    assert_eq!(
        prepared.layers[0].data.get("settings"),
        Some(&Value::String(u("scalar")))
    );
    assert_eq!(
        prepared.layers[1].data.get("settings"),
        Some(&Value::Object(vec![(u("inherited"), Value::Bool(true))]))
    );
    assert_eq!(prepared.prompt_source, Some(u("base")));
    let result = complete(resolve(&chain, &Options::default(), &mut fs)).unwrap();
    assert_eq!(
        result.data.get("settings"),
        Some(&Value::Object(vec![
            (u("own"), Value::Bool(true)),
            (u("inherited"), Value::Bool(true))
        ]))
    );
    assert_eq!(
        result
            .sources
            .iter()
            .find(|(key, _)| *key == u("prompt"))
            .unwrap()
            .1,
        u("base")
    );
}
