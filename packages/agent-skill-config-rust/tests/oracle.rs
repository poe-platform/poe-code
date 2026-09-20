use agent_skill_config_rust::{Catalog, exclude};
use mcp_protocol_rust::json::{self, Limits, Value};
use std::process::Command;
fn field<'a>(value: &'a Value, key: &str) -> &'a Value {
    value.get(key).unwrap()
}
fn string<'a>(value: &'a Value, key: &str) -> &'a [u16] {
    match field(value, key) {
        Value::String(value) => value,
        _ => panic!("Expected oracle string {key}"),
    }
}
#[test]
fn catalog_and_generated_exclude_ownership_match_current_sdk_in_memory() {
    let script = r#"import * as sdk from './packages/agent-skill-config/dist/index.js';import fs from 'node:fs';import {syncBuiltinESMExports}from'node:module';import {fs as memory,vol}from'memfs';for(const key of ['lstatSync','readFileSync','mkdirSync','writeFileSync','renameSync','rmSync'])fs[key]=memory[key];syncBuiltinESMExports();const restore=sdk.setGitDirRunnerForTest(()=>'/repo/.git');const rows=[];for(let i=0;i<128;i++){vol.reset();const path='/repo/.git/info/exclude',content=i%4===0?undefined:i%4===1?'user':i%4===2?'user\r\n':'# custom:run begin\nunfinished\n';if(content!==undefined)vol.fromJSON({[path]:content},'/');const run=i%3?'run':'',prefix=i%5?'custom':'',entries=i%2?['.codex/hooks.json','extra '+i]:[];const first=sdk.appendExcludeBlock('/repo',run,entries,{markerPrefix:prefix}),firstContent=vol.readFileSync(path,'utf8');const second=sdk.appendExcludeBlock('/repo',run,entries,{markerPrefix:prefix}),secondContent=vol.readFileSync(path,'utf8');sdk.removeExcludeBlock('/repo',first,{markerPrefix:prefix});const afterFirst=vol.readFileSync(path,'utf8');sdk.removeExcludeBlock('/repo',second,{markerPrefix:prefix});const cleaned=vol.readFileSync(path,'utf8');rows.push({content:content??null,run,prefix,entries,first,firstContent,second,secondContent,afterFirst,cleaned});}restore();console.log(JSON.stringify({rows,agents:sdk.supportedAgents,configs:sdk.supportedAgents.map(id=>({id,config:sdk.getAgentConfig(id)}))}));"#;
    let output = Command::new("node")
        .args(["--input-type=module", "-e", script])
        .current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let fixture = json::parse(&output.stdout, Limits::default()).unwrap();
    let catalog = Catalog::builtins().unwrap();
    assert_eq!(
        Value::Array(
            catalog
                .supported_agents()
                .into_iter()
                .map(Value::String)
                .collect()
        ),
        *field(&fixture, "agents")
    );
    let Value::Array(configs) = field(&fixture, "configs") else {
        panic!()
    };
    for row in configs {
        assert_eq!(
            &catalog.resolve(string(row, "id")).config.unwrap().raw,
            field(row, "config")
        );
    }
    let Value::Array(rows) = field(&fixture, "rows") else {
        panic!()
    };
    assert_eq!(rows.len(), 128);
    for row in rows {
        let content = match field(row, "content") {
            Value::String(value) => Some(value.as_slice()),
            Value::Null => None,
            _ => panic!(),
        };
        let Value::Array(entries) = field(row, "entries") else {
            panic!()
        };
        let entries = entries
            .iter()
            .map(|entry| match entry {
                Value::String(entry) => entry.clone(),
                _ => panic!(),
            })
            .collect::<Vec<_>>();
        let run = string(row, "run");
        let prefix = string(row, "prefix");
        let first = exclude::append(content, run, &entries, prefix).unwrap();
        assert_eq!(first.id, string(row, "first"));
        assert_eq!(first.content, string(row, "firstContent"));
        let second = exclude::append(Some(&first.content), run, &entries, prefix).unwrap();
        assert_eq!(second.id, string(row, "second"));
        assert_eq!(second.content, string(row, "secondContent"));
        let cleaned = exclude::remove(&second.content, &first.id, prefix).unwrap();
        assert_eq!(cleaned, string(row, "afterFirst"));
        assert_eq!(
            exclude::remove(&cleaned, &second.id, prefix).unwrap(),
            string(row, "cleaned")
        );
    }
}
