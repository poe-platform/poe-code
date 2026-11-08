use poe_agent_rust::tool_results::{Probe, valid_part};
#[test]
fn part_probe_short_circuits_and_keeps_type_reads_staged() {
    let mut trace = vec![];
    let result: Result<bool, ()> = valid_part(|probe| {
        trace.push(probe);
        Ok(matches!(
            probe,
            Probe::TypeString | Probe::Image | Probe::MimeString | Probe::DataString
        ))
    });
    assert_eq!(result, Ok(true));
    assert_eq!(
        trace,
        vec![
            Probe::TypeString,
            Probe::Text,
            Probe::Image,
            Probe::MimeString,
            Probe::DataString
        ]
    );
    let mut calls = 0;
    let result = valid_part(|_| {
        calls += 1;
        Err("opaque")
    });
    assert_eq!(result, Err("opaque"));
    assert_eq!(calls, 1);
}
