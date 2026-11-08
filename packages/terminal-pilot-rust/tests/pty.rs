#[cfg(any(target_os = "macos", target_os = "linux"))]
use terminal_pilot_rust::pty::{Options, Pty};
#[test]
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn invalid_pty_inputs_fail_without_starting_a_process() {
    let mut options = Options {
        command: "/not/a/real/executable".into(),
        args: vec![],
        cwd: None,
        env: vec![],
        cols: 80,
        rows: 24,
    };
    assert!(Pty::spawn(options.clone()).is_err());
    options.command = "/bin/sh".into();
    options.cols = 0;
    assert!(Pty::spawn(options).is_err());
}
