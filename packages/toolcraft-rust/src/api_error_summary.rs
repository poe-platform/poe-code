//! HTTP error recognition, REST/GraphQL precedence and field-error traversal.
use crate::host::Host;

fn yes<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

fn undefined<H: Host>(host: &mut H) -> Result<H::Value, H::Error> {
    host.call("undefined", vec![])
}

fn string_record<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    if !yes(host, "object", vec![value])? {
        return Ok(false);
    }
    let values = host.call("values", vec![value])?;
    yes(host, "allStrings", vec![values])
}

fn recognize<H: Host>(host: &mut H, error: H::Value) -> Result<bool, H::Error> {
    if !yes(host, "object", vec![error])? {
        return Ok(false);
    }
    for key in ["name", "message"] {
        let value = host.get(error, key)?;
        if !yes(host, "string", vec![value])? {
            return Ok(false);
        }
    }
    let request = host.get(error, "request")?;
    let response = host.get(error, "response")?;
    if !yes(host, "object", vec![request])? {
        return Ok(false);
    }
    for key in ["method", "url"] {
        let value = host.get(request, key)?;
        if !yes(host, "string", vec![value])? {
            return Ok(false);
        }
    }
    let headers = host.get(request, "headers")?;
    if !string_record(host, headers)? || !yes(host, "object", vec![response])? {
        return Ok(false);
    }
    let status = host.get(response, "status")?;
    if !yes(host, "number", vec![status])? {
        return Ok(false);
    }
    let text = host.get(response, "statusText")?;
    if !yes(host, "string", vec![text])? {
        return Ok(false);
    }
    let headers = host.get(response, "headers")?;
    if !string_record(host, headers)? {
        return Ok(false);
    }
    yes(host, "ownBody", vec![response])
}

fn first_string<H: Host>(
    host: &mut H,
    body: H::Value,
    fields: &[&str],
) -> Result<H::Value, H::Error> {
    if yes(host, "object", vec![body])? {
        for field in fields {
            let value = host.get(body, field)?;
            if yes(host, "string", vec![value])? && yes(host, "positiveLength", vec![value])? {
                return Ok(value);
            }
        }
    }
    undefined(host)
}

fn graphql_first<H: Host>(host: &mut H, body: H::Value) -> Result<H::Value, H::Error> {
    let errors = host.get(body, "errors")?;
    if yes(host, "array", vec![errors])? {
        let errors = host.get(body, "errors")?;
        host.call("first", vec![errors])
    } else {
        undefined(host)
    }
}

fn extract<H: Host>(host: &mut H, body: H::Value, code: bool) -> Result<H::Value, H::Error> {
    if !yes(host, "object", vec![body])? {
        return undefined(host);
    }
    let first = graphql_first(host, body)?;
    if yes(host, "object", vec![first])? {
        if code {
            let extensions = host.get(first, "extensions")?;
            if yes(host, "object", vec![extensions])? {
                let extensions = host.get(first, "extensions")?;
                let value = host.get(extensions, "code")?;
                if yes(host, "string", vec![value])? {
                    let extensions = host.get(first, "extensions")?;
                    let code = host.get(extensions, "code")?;
                    if !host.is_undefined(code)? {
                        return Ok(code);
                    }
                }
            }
        } else {
            let message = host.get(first, "message")?;
            if yes(host, "string", vec![message])? {
                let message = host.get(first, "message")?;
                if !host.is_undefined(message)? {
                    return Ok(message);
                }
            }
        }
    }
    first_string(
        host,
        body,
        if code {
            &["code", "error_code", "errorCode", "error"]
        } else {
            &["message", "detail", "title", "error_description"]
        },
    )
}

fn header<H: Host>(host: &mut H, headers: H::Value, name: &str) -> Result<H::Value, H::Error> {
    let name = host.call(name, vec![])?;
    let lower = host.call("lower", vec![name])?;
    host.call("findHeader", vec![headers, lower])
}

fn optional<H: Host>(
    host: &mut H,
    output: H::Value,
    key: &str,
    value: H::Value,
) -> Result<(), H::Error> {
    if !host.is_undefined(value)? {
        host.call(&format!("set:{key}"), vec![output, value])?;
    }
    Ok(())
}

fn summary<H: Host>(host: &mut H, error: H::Value) -> Result<H::Value, H::Error> {
    let response = host.get(error, "response")?;
    let body = host.get(response, "body")?;
    let body = host.call("redact", vec![body])?;
    let response = host.get(error, "response")?;
    let headers = host.get(response, "headers")?;
    let retry = header(host, headers, "retryHeader")?;
    let message = extract(host, body, false)?;
    let output = host.call("summaryFields", vec![error])?;
    optional(host, output, "message", message)?;
    let response = host.get(error, "response")?;
    let headers = host.get(response, "headers")?;
    let mut request_id = header(host, headers, "requestHeader")?;
    if host.is_nullish(request_id)? {
        request_id = first_string(host, body, &["request_id", "requestId", "id"])?;
    }
    optional(host, output, "requestId", request_id)?;
    let code = extract(host, body, true)?;
    optional(host, output, "code", code)?;
    optional(host, output, "retryAfter", retry)?;
    if yes(host, "object", vec![body])? {
        let candidates = host.call("candidates", vec![body])?;
        let fields = host.call("flattenCandidates", vec![candidates])?;
        if !yes(host, "zeroLength", vec![fields])? {
            optional(host, output, "fieldErrors", fields)?;
        }
    }
    let response = host.get(error, "response")?;
    let status = host.get(response, "status")?;
    if yes(host, "equals401", vec![status])? || yes(host, "equals403", vec![status])? {
        let hint = host.call("authHint", vec![])?;
        optional(host, output, "hint", hint)?;
    } else if (yes(host, "equals429", vec![status])? || yes(host, "equals503", vec![status])?)
        && !host.is_undefined(retry)?
    {
        let hint = host.call("retryHint", vec![retry])?;
        optional(host, output, "hint", hint)?;
    }
    Ok(output)
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("recognize", [error]) => {
            let recognized = recognize(host, *error)?;
            host.call(if recognized { "true" } else { "false" }, vec![])
        }
        ("summary", [error]) => summary(host, *error),
        ("header", [key, value, name]) => {
            let key = host.call("lower", vec![*key])?;
            if host.same(key, *name)? && yes(host, "positiveLength", vec![*value])? {
                Ok(*value)
            } else {
                undefined(host)
            }
        }
        ("flatten", [value, path]) => {
            if yes(host, "string", vec![*value])? {
                return host.call("field", vec![*path, *value]);
            }
            if yes(host, "array", vec![*value])? {
                let strings = yes(host, "allStrings", vec![*value])?;
                return host.call(
                    if strings {
                        "stringFields"
                    } else {
                        "arrayFields"
                    },
                    vec![*value, *path],
                );
            }
            if !yes(host, "object", vec![*value])? {
                return host.call("empty", vec![]);
            }
            host.call("objectFields", vec![*value, *path])
        }
        ("envelope", [error, report]) => {
            let summary = summary(host, *error)?;
            let mut message = host.get(summary, "message")?;
            if host.is_nullish(message)? {
                message = host.get(*error, "message")?;
            }
            let output = host.call("envelopeBase", vec![message])?;
            for key in ["code", "requestId"] {
                let value = host.get(summary, key)?;
                if !host.is_undefined(value)? {
                    let value = host.get(summary, key)?;
                    optional(host, output, key, value)?;
                }
            }
            let http = host.call("httpFields", vec![summary])?;
            optional(host, output, "http", http)?;
            for key in ["fieldErrors", "retryAfter", "hint"] {
                let value = host.get(summary, key)?;
                if !host.is_undefined(value)? {
                    let value = host.get(summary, key)?;
                    optional(host, output, key, value)?;
                }
            }
            optional(host, output, "reportPath", *report)?;
            Ok(output)
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
