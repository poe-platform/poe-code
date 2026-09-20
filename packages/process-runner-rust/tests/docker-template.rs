use process_runner_rust::docker_template::{self, Entry, Template};
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn template_hash_matches_sdk_delimiters_binary_payloads_and_utf16_replacement() {
    let files = [Entry {
        path: &[97, 0xd800],
        bytes: &[0, 255],
    }];
    let args = [(u("A"), u("1")), (u("Z"), u("last"))];
    let hash = docker_template::hash(b"FROM scratch", &files, &args, &u("docker"));
    assert_eq!(
        hash,
        "0788f0b7e3d4d73205cf91231a859b040fc8dc8d45bf7df65fb69e9f861ce8b8"
    );
    assert_ne!(
        hash,
        docker_template::hash(b"FROM scratch", &files, &args, &u("podman"))
    );
}
#[test]
fn cache_policy_only_accepts_present_images_and_build_plan_preserves_sorted_pairs() {
    let plan = Template::new("abc".into());
    assert_eq!(plan.image(), "poe-code/local:abc");
    assert!(!plan.cached(false, Some(&u("")), 1));
    assert!(!plan.cached(true, Some(&u("image")), 0));
    assert!(plan.cached(false, Some(&u("")), 0));
    assert!(!plan.cached(false, None, 0));
    assert_eq!(
        plan.build_args(
            &u("docker"),
            Some(&u("colima")),
            &u("/repo/Dockerfile"),
            &u("/repo"),
            &[(u("A"), u("1")), (u("Z"), u("last"))]
        ),
        [
            "--context",
            "colima",
            "build",
            "--tag",
            "poe-code/local:abc",
            "-f",
            "/repo/Dockerfile",
            "--build-arg",
            "A=1",
            "--build-arg",
            "Z=last",
            "/repo"
        ]
        .map(u)
    );
}
#[test]
fn canonical_relative_path_policy_matches_sdk_prefix_checks() {
    assert!(docker_template::inside(&[], false));
    assert!(docker_template::inside(&u("file"), false));
    assert!(!docker_template::inside(&u("../escape"), false));
    // SDK currently rejects ordinary names beginning with two dots too.
    assert!(!docker_template::inside(&u("..file"), false));
    assert!(!docker_template::inside(&u("/absolute"), true));
}
