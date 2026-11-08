use mcp_protocol_rust::json::Value;
use poe_code_config_rust::compiler::{Mode, compile, scan};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn imports_aliases_static_scopes_and_metadata() {
    let source=scan("/a.ts",&u(r#"import type {X} from './type.js'; import {defineScope as scope} from '@poe-code/poe-code-config/core'; export {a} from './other.js'; export const settings=scope('core',{enabled:{type:'boolean',default:true,doc:`Enabled`},text:{type:'string',default:'\ud800',doc:'Text',env:'ENV'}});"#),Mode::All).unwrap();
    assert_eq!(
        source.imports,
        vec![u("@poe-code/poe-code-config/core"), u("./other.js")]
    );
    let document = compile(vec![source], Value::Object(vec![])).unwrap();
    let Value::Object(fields) = document else {
        panic!()
    };
    assert!(fields.iter().any(|(key, _)| *key == u("properties")));
}
#[test]
fn comments_strings_nested_declarations_and_unexported_scopes_are_ignored() {
    let source=scan("/a.ts",&u(r#"import {defineScope} from '@poe-code/poe-code-config'; const hidden=defineScope('hidden',{x:{type:'boolean',default:true,doc:'x'}}); function f(){const inner=defineScope('inner',{});} const text='export const bad=defineScope("bad",{})'; // export const bad=defineScope('bad',{});
 export const real=defineScope('real',{x:{type:'number',default:1,doc:'x'}});"#),Mode::All).unwrap();
    assert_eq!(source.fragments.len(), 1);
    assert_eq!(source.fragments[0].scope, u("real"));
}
#[test]
fn duplicate_fields_and_json_metadata_have_original_diagnostics() {
    let duplicate=scan("/a.ts",&u("import {defineScope} from '@poe-code/poe-code-config'; export const s=defineScope('s',{x:{type:'number',default:1,doc:'x'},x:{type:'number',default:2,doc:'x'}});"),Mode::All).unwrap_err();
    assert!(duplicate.contains("Duplicate config field \"s.x\""));
    let error=scan("/a.ts",&u("import {defineScope} from '@poe-code/poe-code-config'; export const s=defineScope('s',{x:{type:'json',default:null as unknown,parse:dynamic,doc:'x'}});"),Mode::All).unwrap_err();
    assert!(error.contains("uses json"));
}
#[test]
fn source_and_nesting_budgets_fail_without_panics() {
    let text = format!("{}0{}", "(".repeat(600), ")".repeat(600));
    assert!(scan("/a.ts", &u(&text), Mode::All).is_err());
}
