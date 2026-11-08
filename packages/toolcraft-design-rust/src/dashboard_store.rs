//! Dashboard state transitions and bounded output retention.
use crate::feedback::Host;

const MAX_RETAINED_OUTPUT: f64 = 256.;

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
        ("initialize", []) => {
            let idle = host.literal("idle")?;
            let zero = host.number(0.)?;
            host.call("initialize", vec![idle, zero])
        }
        ("append", [item]) => {
            let text = host.get(*item, "text")?;
            let preview = host.call("preview", vec![text])?;
            let detail = host.get(*item, "detail")?;
            let detail = if host.is_undefined(detail)? {
                detail
            } else {
                let detail = host.get(*item, "detail")?;
                host.call("preview", vec![detail])?
            };
            let text = host.get(*item, "text")?;
            let same_text = predicate(host, "same", vec![preview, text])?;
            let unchanged = same_text && {
                let source_detail = host.get(*item, "detail")?;
                predicate(host, "same", vec![detail, source_detail])?
            };
            let retained = if unchanged {
                *item
            } else {
                host.call("retained", vec![*item, preview, detail])?
            };
            let id = host.get(*item, "id")?;
            let missing = host.number(-1.)?;
            let existing = if host.is_undefined(id)? {
                missing
            } else {
                host.call("find", vec![*item])?
            };
            let next = if !predicate(host, "same", vec![existing, missing])? {
                host.call("replace", vec![existing, retained])?
            } else {
                let length = host.call("outputLength", vec![])?;
                let limit = host.number(MAX_RETAINED_OUTPUT)?;
                if predicate(host, "gte", vec![length, limit])? {
                    host.call("trimAppend", vec![retained, limit])?
                } else {
                    host.call("append", vec![retained])?
                }
            };
            let next = host.call("updatedOutput", vec![next])?;
            host.call("commit", vec![next])
        }
        ("matchId", [entry, item]) => {
            let a = host.get(*entry, "id")?;
            let b = host.get(*item, "id")?;
            host.call("same", vec![a, b])
        }
        ("update", [partial]) => {
            // Spread the old state before reading its stats: getters may reenter.
            let next = host.call("cloneState", vec![])?;
            let stats = host.call("stats", vec![])?;
            let stats = host.call("merge", vec![stats, *partial])?;
            let next = host.call("updatedStats", vec![next, stats])?;
            host.call("commit", vec![next])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}
