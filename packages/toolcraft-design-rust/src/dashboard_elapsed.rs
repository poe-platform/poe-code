//! Dashboard elapsed time normalization and hours/minutes/seconds decomposition.
use crate::feedback::Host;

pub fn format<H: Host>(host: &mut H, value: H::Value) -> Result<H::Value, H::Error> {
    let finite = host.call("finite", vec![value])?;
    let zero = host.number(0.)?;
    let safe = if host.is_true(finite)? { value } else { zero };
    let thousand = host.number(1_000.)?;
    let seconds = host.call("divide", vec![safe, thousand])?;
    let seconds = host.call("floor", vec![seconds])?;
    let seconds = host.call("max", vec![zero, seconds])?;
    let per_hour = host.number(3_600.)?;
    let hours = host.call("divide", vec![seconds, per_hour])?;
    let hours = host.call("floor", vec![hours])?;
    let minutes = host.call("remainder", vec![seconds, per_hour])?;
    let per_minute = host.number(60.)?;
    let minutes = host.call("divide", vec![minutes, per_minute])?;
    let minutes = host.call("floor", vec![minutes])?;
    let seconds = host.call("remainder", vec![seconds, per_minute])?;
    let padding = host.number(2.)?;
    let fill = host.literal("0")?;
    let separator = host.literal(":")?;
    host.call(
        "format",
        vec![hours, minutes, seconds, padding, fill, separator],
    )
}
