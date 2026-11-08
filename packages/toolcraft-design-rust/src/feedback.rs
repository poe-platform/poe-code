//! Bounded notices, rolling metrics and inline progress policy.
use crate::text_cells;
pub trait Host: text_cells::Host {
    fn literal(&mut self, text: &'static str) -> Result<Self::Value, Self::Error>;
}
fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("validate", [capacity]) => {
            let one = host.number(1.)?;
            if !predicate(host, "integer", vec![*capacity])?
                || predicate(host, "lt", vec![*capacity, one])?
            {
                return host.call("invalidCapacity", vec![]);
            }
            host.call("undefined", vec![])
        }
        ("notice", [notice, width]) => {
            let info = host.literal("●")?;
            let success = host.literal("✓")?;
            let warning = host.literal("▲")?;
            let error = host.literal("■")?;
            let marker = host.call("noticeMarker", vec![*notice, info, success, warning, error])?;
            let marker = host.call("markerText", vec![marker])?;
            let text = host.get(*notice, "text")?;
            let text = host.call("plain", vec![text])?;
            let value = host.call("noticeText", vec![marker, text])?;
            host.call("fit", vec![value, *width])
        }
        ("progress", [item, width]) => {
            let total = host.get(*item, "total")?;
            let zero = host.number(0.)?;
            let known = if host.is_undefined(total)? {
                false
            } else {
                let total = host.get(*item, "total")?;
                if !predicate(host, "gt", vec![total, zero])?
                    || !predicate(host, "finiteTotal", vec![*item])?
                {
                    false
                } else {
                    let completed = host.get(*item, "completed")?;
                    !host.is_undefined(completed)?
                        && predicate(host, "finiteCompleted", vec![*item])?
                }
            };
            let progress = if known {
                host.call("percentage", vec![*item])?
            } else {
                host.literal("…")?
            };
            let status = host.get(*item, "status")?;
            let marker = if host.is_kind(status, "success")? {
                host.literal("✓")?
            } else {
                let status = host.get(*item, "status")?;
                host.literal(if host.is_kind(status, "error")? {
                    "■"
                } else {
                    "●"
                })?
            };
            let label = host.get(*item, "label")?;
            let label = host.call("plain", vec![label])?;
            let value = host.call("progressText", vec![marker, label, progress])?;
            host.call("fit", vec![value, *width])
        }
        ("put", [notices, capacity, now, id, notice, duration]) => {
            host.call(
                "publishNotice",
                vec![*notices, *id, *notice, *now, *duration],
            )?;
            let size = host.get(*notices, "size")?;
            if predicate(host, "gt", vec![size, *capacity])? {
                host.call("evict", vec![*notices])?;
            }
            host.call("undefined", vec![])
        }
        ("notices", [notices, now]) => {
            let time = host.call("clock", vec![*now])?;
            host.call("expireEntries", vec![*notices, time])?;
            host.call("noticeSnapshots", vec![*notices])
        }
        ("expire", [notices, id, entry, time]) => {
            let expires = host.get(*entry, "expires")?;
            if predicate(host, "le", vec![expires, *time])? {
                host.call("delete", vec![*notices, *id])?;
            }
            host.call("undefined", vec![])
        }
        ("metricPush", [state, capacity, value]) => {
            // Capture the assignment reference before a reentrant finite check.
            let values = host.get(*state, "values")?;
            let cursor = host.get(*state, "cursor")?;
            let value = if !predicate(host, "isNull", vec![*value])?
                && predicate(host, "finite", vec![*value])?
            {
                *value
            } else {
                host.call("null", vec![])?
            };
            host.call("setIndex", vec![values, cursor, value])?;
            host.call("metricAdvance", vec![*state, *capacity])
        }
        ("metricRender", [state, capacity, unit, width]) => {
            let samples = host.call("metricRenderSamples", vec![*state, *capacity, *width])?;
            let missing = host.call("null", vec![])?;
            let known = host.call("knownSamples", vec![samples, missing])?;
            let min = host.call("min", vec![known])?;
            let max = host.call("max", vec![known])?;
            let spark = host.call("sparkMap", vec![samples, min, max])?;
            let spark = host.call("join", vec![spark])?;
            let count = host.get(*state, "count")?;
            let latest = if predicate(host, "truthy", vec![count])? {
                host.call("metricLatest", vec![*state, *capacity])?
            } else {
                missing
            };
            let latest = if predicate(host, "nullish", vec![latest])? {
                host.literal("—")?
            } else {
                latest
            };
            let value = host.call("metricText", vec![latest, *unit, spark])?;
            host.call("fit", vec![value, *width])
        }
        ("spark", [value, min, max]) => {
            if predicate(host, "isNull", vec![*value])? {
                return host.literal("·");
            }
            let levels = host.literal("▁▂▃▄▅▆▇█")?;
            let index = if predicate(host, "same", vec![*max, *min])? {
                host.number(3.)?
            } else {
                host.call("sparkIndex", vec![*value, *min, *max])?
            };
            host.call("at", vec![levels, index])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
