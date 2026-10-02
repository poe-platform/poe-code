use napi::bindgen_prelude::Utf16String;
use napi_derive::napi;
use toolcraft_rust::ApiVersionIssue;

pub mod api_error_summary;
pub mod applied_default;
pub mod approval_commands;
pub mod approval_gate;
pub mod approval_plan;
pub mod approval_runner;
pub mod approval_tasks;
pub mod branch_validation;
pub mod cli_fields;
pub mod cli_help_fields;
pub mod cli_policy;
pub mod cli_snapshot;
pub mod definitions;
pub mod error_report;
mod host;
pub mod json_schema_converter;
pub mod mcp_proxy;
pub mod mcp_result;
pub mod number_schema;
pub mod package_metadata;
pub mod redaction;
pub mod renderer;
pub mod runtime_policy;
pub mod schema_members;
pub mod schema_scope;
pub mod sdk;
pub mod sdk_validation;
pub mod source_snippet;
pub mod stack_trim;
pub mod stream;

#[napi]
pub fn candidate_distances(input: Utf16String, candidates: Vec<Utf16String>) -> Vec<f64> {
    let candidates: Vec<Vec<u16>> = candidates
        .into_iter()
        .map(|value| value.as_ref().to_vec())
        .collect();
    toolcraft_rust::candidate_distances(input.as_ref(), &candidates)
        .into_iter()
        .map(|distance| distance as f64)
        .collect()
}

#[napi]
pub fn api_version_issue(
    requirement: Utf16String,
    runner: Option<Utf16String>,
) -> Option<&'static str> {
    let requirement = String::from_utf16_lossy(requirement.as_ref());
    let runner = runner.map(|value| String::from_utf16_lossy(value.as_ref()));
    toolcraft_rust::api_version_issue(&requirement, runner.as_deref()).map(|issue| match issue {
        ApiVersionIssue::InvalidRequirement => "invalidRequirement",
        ApiVersionIssue::MissingRunner => "missingRunner",
        ApiVersionIssue::InvalidRunner => "invalidRunner",
        ApiVersionIssue::TooOld => "tooOld",
    })
}

#[napi]
pub fn is_log_level(value: String) -> bool {
    toolcraft_rust::is_log_level(&value)
}

#[napi]
pub fn should_emit_diagnostic(event: String, configured: String) -> bool {
    toolcraft_rust::should_emit_diagnostic(&event, &configured)
}

#[napi]
pub fn http_error_class(status: f64) -> &'static str {
    toolcraft_rust::http_error_class(status)
}
