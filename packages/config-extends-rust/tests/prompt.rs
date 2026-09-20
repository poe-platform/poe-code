use config_extends_rust::{Layer, prompt::compose_prompts};
use config_mutations_rust::value::Value;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn layer(source: &str, prompt: Value) -> Layer {
    Layer {
        source: u(source),
        data: Value::Object(vec![(u("prompt"), prompt)]),
    }
}
fn s(text: &str) -> Value {
    Value::String(u(text))
}
#[test]
fn yield_composes_wrappers_and_tracks_first_nonempty_prompt_source() {
    let result = compose_prompts(
        &layer("document", s("Doc: {{yield}}")),
        &[
            layer("base", s("Base: {{yield}}")),
            layer("deep", s("Deep")),
        ],
    )
    .unwrap()
    .unwrap();
    assert_eq!(result.prompt, u("Doc: Base: Deep"));
    assert_eq!(result.source, Some(u("document")));
    assert_eq!(result.consumed, [0, 1]);
    let result = compose_prompts(&layer("document", s("")), &[layer("base", s("{{yield}}"))])
        .unwrap()
        .unwrap();
    assert_eq!(result.prompt, u(""));
    assert_eq!(result.source, Some(u("base")));
}
#[test]
fn absent_prompts_inherit_and_nonstring_prompts_stop_composition() {
    let result = compose_prompts(
        &layer("document", Value::Undefined),
        &[
            layer("empty", Value::Undefined),
            layer("base", s("Base")),
            layer("stop", Value::Null),
            layer("ignored", s("{{yield}}{{yield}}")),
        ],
    )
    .unwrap()
    .unwrap();
    assert_eq!(result.prompt, u("Base"));
    assert_eq!(result.source, Some(u("base")));
    assert_eq!(result.consumed, [1]);
    assert!(
        compose_prompts(
            &layer("document", Value::Null),
            &[layer("base", s("{{yield}}{{yield}}"))]
        )
        .unwrap()
        .is_none()
    );
    assert!(
        compose_prompts(&layer("document", Value::Undefined), &[])
            .unwrap()
            .is_none()
    );
}
#[test]
fn invalid_yield_counts_and_final_unresolved_yield_are_rejected() {
    assert_eq!(
        compose_prompts(&layer("document", s("{{yield}}{{yield}}")), &[]).unwrap_err(),
        "Prompt composition supports exactly one \"{{yield}}\" token per prompt."
    );
    assert_eq!(
        compose_prompts(&layer("document", s("{{yield}}")), &[]).unwrap_err(),
        "Final resolved prompt contains an unresolved \"{{yield}}\" token."
    );
}
#[test]
fn lower_wrapper_can_wrap_a_nonempty_higher_prompt_and_preserve_surrogates() {
    let result = compose_prompts(
        &layer("document", Value::String(vec![0xd800])),
        &[layer("base", s("Before {{yield}} After"))],
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        result.prompt,
        [u("Before "), vec![0xd800], u(" After")].concat()
    );
    assert_eq!(result.source, Some(u("document")));
}
