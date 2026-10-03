//! Native Toolcraft policies. Node capabilities live in the binding adapter.

pub mod api_error_summary;
pub mod applied_default;
pub mod approval_commands;
pub mod approval_gate;
pub mod approval_plan;
pub mod approval_runner;
pub mod approval_tasks;
pub mod branch_validation;
pub mod cli_argv;
pub mod cli_commands;
pub mod cli_consume;
pub mod cli_dynamic_argv;
pub mod cli_dynamic_paths;
pub mod cli_dynamic_values;
pub mod cli_errors;
pub mod cli_execution;
pub mod cli_fields;
pub mod cli_fixtures;
pub mod cli_generated_help;
pub mod cli_help_fields;
pub mod cli_json_errors;
pub mod cli_options;
pub mod cli_params;
pub mod cli_policy;
pub mod cli_prepare;
pub mod cli_presets;
pub mod cli_prompts;
pub mod cli_runtime;
pub mod cli_snapshot;
pub mod cli_values;
pub mod cli_variants;
pub mod definitions;
pub mod error_report;
pub mod host;
pub mod json_schema_converter;
pub mod mcp_proxy;
pub mod number_schema;
pub mod package_metadata;
pub mod redaction;
pub mod renderer;
pub mod runtime_policy;
pub mod schema_members;
pub mod schema_scope;
pub mod sdk;
pub mod sdk_casing;
pub mod sdk_validation;
pub mod source_snippet;
pub mod stack_trim;
pub mod stream;
pub mod suggest;

/// Optimal string alignment distance over JavaScript UTF-16 code units.
/// Three rows retain adjacent-transposition semantics without a quadratic matrix.
pub fn candidate_distances(input: &[u16], candidates: &[Vec<u16>]) -> Vec<usize> {
    candidates
        .iter()
        .map(|candidate| distance(input, candidate))
        .collect()
}

fn distance(left: &[u16], right: &[u16]) -> usize {
    let (left, right) = if left.len() < right.len() {
        (right, left)
    } else {
        (left, right)
    };
    let mut previous_previous = vec![0; right.len() + 1];
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    let mut current = vec![0; right.len() + 1];
    for row in 1..=left.len() {
        current[0] = row;
        for column in 1..=right.len() {
            let substitution =
                previous[column - 1] + usize::from(left[row - 1] != right[column - 1]);
            current[column] = (previous[column] + 1)
                .min(current[column - 1] + 1)
                .min(substitution);
            if row > 1
                && column > 1
                && left[row - 1] == right[column - 2]
                && left[row - 2] == right[column - 1]
            {
                current[column] = current[column].min(previous_previous[column - 2] + 1);
            }
        }
        std::mem::swap(&mut previous_previous, &mut previous);
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

#[derive(Debug, PartialEq, Eq)]
pub enum ApiVersionIssue {
    InvalidRequirement,
    MissingRunner,
    InvalidRunner,
    TooOld,
}

pub fn api_version_issue(requirement: &str, runner: Option<&str>) -> Option<ApiVersionIssue> {
    let Some(minimum) = requirement
        .strip_prefix(">=")
        .and_then(|text| parse_version(text.trim_matches(ecmascript_whitespace)))
    else {
        return Some(ApiVersionIssue::InvalidRequirement);
    };
    let Some(runner) = runner else {
        return Some(ApiVersionIssue::MissingRunner);
    };
    let Some(actual) = parse_version(runner) else {
        return Some(ApiVersionIssue::InvalidRunner);
    };
    (actual < minimum).then_some(ApiVersionIssue::TooOld)
}

fn parse_version(value: &str) -> Option<[f64; 3]> {
    let mut parts = value.split('.');
    let mut version = [0.0_f64; 3];
    for component in &mut version {
        let part = parts.next()?;
        if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        *component = part.parse().ok()?;
        if !component.is_finite() {
            return None;
        }
    }
    parts.next().is_none().then_some(version)
}

fn ecmascript_whitespace(value: char) -> bool {
    matches!(value, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

pub const LOG_LEVELS: [&str; 6] = ["silent", "error", "warn", "info", "debug", "trace"];

pub fn is_log_level(value: &str) -> bool {
    LOG_LEVELS.contains(&value)
}

pub fn should_emit_diagnostic(event: &str, configured: &str) -> bool {
    match (
        LOG_LEVELS.iter().position(|level| *level == event),
        LOG_LEVELS.iter().position(|level| *level == configured),
    ) {
        (Some(event), Some(configured)) => event != 0 && configured != 0 && event <= configured,
        _ => false,
    }
}

pub fn http_error_class(status: f64) -> &'static str {
    match status {
        400.0 => "BadRequestError",
        401.0 => "AuthenticationError",
        403.0 => "PermissionDeniedError",
        404.0 => "NotFoundError",
        409.0 => "ConflictError",
        422.0 => "UnprocessableEntityError",
        429.0 => "RateLimitError",
        500.0 => "InternalServerError",
        503.0 => "ServiceUnavailableError",
        status if (400.0..500.0).contains(&status) => "ClientError",
        status if status >= 500.0 => "ServerError",
        _ => "HttpError",
    }
}
