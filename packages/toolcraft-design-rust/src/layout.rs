//! Portable dashboard geometry, including compact terminal behavior.
use mcp_protocol_rust::json::Value;
fn maximum(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}
fn minimum(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}
fn coordinate(value: f64, max: f64) -> f64 {
    maximum(0.0, minimum(value, max))
}
fn object(fields: &[(&str, f64)]) -> Value {
    Value::Object(
        fields
            .iter()
            .map(|(key, value)| (key.encode_utf16().collect(), Value::Number(*value)))
            .collect(),
    )
}
fn rect(x: f64, y: f64, width: f64, height: f64) -> Value {
    object(&[("x", x), ("y", y), ("width", width), ("height", height)])
}
/// Values are already host-coerced; Rust applies the common size/layout policy.
pub fn geometry(values: [f64; 5]) -> [f64; 25] {
    let [total_width, total_height, border, footer, requested_right] =
        values.map(|value| maximum(0.0, value.floor()));
    let max_x = maximum(0.0, total_width - 1.0);
    let max_y = maximum(0.0, total_height - 1.0);
    let inner_width = maximum(0.0, total_width - border * 2.0);
    let inner_height = maximum(0.0, total_height - border * 2.0);
    let inner_x = coordinate(border, max_x);
    let inner_y = coordinate(border, max_y);
    let divider_width = if inner_width > 0.0 { 1.0 } else { 0.0 };
    let available = maximum(0.0, inner_width - divider_width);
    let left_width = if available <= 0.0 {
        0.0
    } else {
        maximum(
            0.0,
            available - minimum(requested_right, maximum(0.0, available - 20.0)),
        )
    };
    let right_width = maximum(0.0, available - left_width);
    let footer_height = minimum(footer, inner_height);
    let footer_divider_height = if inner_height > footer_height {
        1.0
    } else {
        0.0
    };
    let content_height = maximum(0.0, inner_height - footer_height - footer_divider_height);
    let divider_x = coordinate(inner_x + left_width, max_x);
    let divider_bottom = coordinate(inner_y + maximum(content_height - 1.0, 0.0), max_y);
    let footer_divider_y = coordinate(inner_y + content_height, max_y);
    let footer_y = coordinate(footer_divider_y + footer_divider_height, max_y);
    let footer_right = coordinate(maximum(inner_x, total_width - border - 1.0), max_x);
    let compact = inner_width > 0.0 && requested_right > 0.0 && available < 40.0 + requested_right;
    let summary_height = minimum(2.0, content_height);
    [
        f64::from(compact),
        total_width,
        total_height,
        inner_x,
        if compact {
            inner_y + summary_height
        } else {
            inner_y
        },
        if compact { inner_width } else { left_width },
        if compact {
            maximum(0.0, content_height - summary_height)
        } else {
            content_height
        },
        if compact {
            max_x
        } else {
            coordinate(divider_x + divider_width, max_x)
        },
        inner_y,
        if compact { 0.0 } else { right_width },
        if compact { 0.0 } else { content_height },
        if compact { max_x } else { divider_x },
        inner_y,
        if compact { inner_y } else { divider_bottom },
        inner_x,
        footer_y,
        inner_width,
        footer_height,
        footer_divider_y,
        inner_x,
        footer_right,
        inner_x,
        inner_y,
        inner_width,
        summary_height,
    ]
}
/// Structured geometry for standalone Rust callers.
pub fn compute(values: [f64; 5]) -> Value {
    let data = geometry(values);
    let mut fields = vec![
        ("outerBorder", rect(0.0, 0.0, data[1], data[2])),
        ("leftPane", rect(data[3], data[4], data[5], data[6])),
        ("rightPane", rect(data[7], data[8], data[9], data[10])),
        (
            "divider",
            object(&[("x", data[11]), ("top", data[12]), ("bottom", data[13])]),
        ),
        ("footer", rect(data[14], data[15], data[16], data[17])),
        (
            "footerDivider",
            object(&[("y", data[18]), ("left", data[19]), ("right", data[20])]),
        ),
    ];
    if data[0] != 0.0 {
        fields.push(("summary", rect(data[21], data[22], data[23], data[24])));
    }
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    )
}
