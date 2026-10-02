//! Repaint accounting, rolling frame rates and percentile selection.
use crate::text_cells::Host;
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
            let maximum = host.number(4096.)?;
            if !predicate(host, "integer", vec![*capacity])?
                || predicate(host, "lt", vec![*capacity, one])?
                || predicate(host, "gt", vec![*capacity, maximum])?
            {
                return host.call("invalidCapacity", vec![]);
            }
            host.call("undefined", vec![])
        }
        ("request", [state, now, kind]) => {
            host.call("request", vec![*state])?;
            if host.is_kind(*kind, "input")? {
                host.call("input", vec![*state, *now])?;
            }
            host.call("undefined", vec![])
        }
        ("end", [state, capacity, now, started, frame]) => {
            let finished = host.call("clock", vec![*now])?;
            let duration = host.call("duration", vec![finished, *started])?;
            host.call("recordDuration", vec![*state, *capacity, duration])?;
            host.call("longest", vec![*state, duration])?;
            let zero = host.number(0.)?;
            let changed = host.get(*frame, "changedCells")?;
            if predicate(host, "gt", vec![changed, zero])? {
                let budget = host.number(1000. / 60.)?;
                if predicate(host, "gt", vec![duration, budget])? {
                    host.call("slow", vec![*state])?;
                }
            }
            host.call("rendered", vec![*state])?;
            let first = host.get(*state, "firstInput")?;
            if !host.is_undefined(first)? {
                host.call("recordInput", vec![*state, *capacity, finished])?;
            }
            let changed = host.get(*frame, "changedCells")?;
            if predicate(host, "gt", vec![changed, zero])? {
                host.call("frame", vec![*state, *frame])?;
                let bucket = host.call("bucket", vec![finished])?;
                let buckets = host.get(*state, "buckets")?;
                let counts = host.get(*state, "counts")?;
                let index = host.call("bucketIndex", vec![bucket, buckets])?;
                let previous = host.call("at", vec![buckets, index])?;
                if !predicate(host, "same", vec![previous, bucket])? {
                    host.call("resetBucket", vec![buckets, counts, index, bucket])?;
                }
                host.call("countBucket", vec![counts, index])?;
            }
            host.call("undefined", vec![])
        }
        ("snapshot", [state, capacity, now]) => {
            let time = host.call("clock", vec![*now])?;
            let mut fps = host.number(0.)?;
            let buckets = host.get(*state, "buckets")?;
            let counts = host.get(*state, "counts")?;
            let mut index = 0.0;
            loop {
                let current = host.number(index)?;
                let length = host.get(buckets, "length")?;
                if !predicate(host, "lt", vec![current, length])? {
                    break;
                }
                if predicate(host, "lower", vec![buckets, current, time])?
                    && predicate(host, "upper", vec![buckets, current, time])?
                {
                    let count = host.call("at", vec![counts, current])?;
                    fps = host.call("add", vec![fps, count])?;
                }
                index += 1.0;
            }
            host.call("snapshot", vec![*state, fps, *capacity])
        }
        ("percentiles", [samples, count]) => {
            let zero = host.number(0.)?;
            if predicate(host, "same", vec![*count, zero])? {
                return host.call("zeroPercentiles", vec![]);
            }
            let sorted = host.call("sort", vec![*samples, *count])?;
            host.call("percentiles", vec![sorted, *count])
        }
        ("format", [stats, width]) => {
            let text = host.call("format", vec![*stats])?;
            host.call("fit", vec![text, *width])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
