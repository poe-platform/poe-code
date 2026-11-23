use agent_skill_config_rust::skill_catalog::{Skill, render};

fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn file(name: &str, content: &str) -> Skill {
    Skill {
        name: u(name),
        file: u(&format!("/skills/{name}/SKILL.md")),
        content: u(content),
    }
}

#[test]
fn native_catalog_renders_user_and_system_metadata_without_instruction_bodies() {
    let files = [
        file(
            "report",
            "---\nname: shared\ndescription: User report\n---\nSECRET_BODY",
        ),
        file(
            ".system/report",
            "---\nname: shared\ndescription: System report\n---\nSECRET_BODY",
        ),
    ];
    let catalog = String::from_utf16(&render(&files).unwrap()).unwrap();
    assert!(catalog.starts_with("<skills_instructions>\n## Skills\n"));
    assert!(catalog.contains("- shared: User report (file: /skills/report/SKILL.md)"));
    assert!(catalog.contains("- shared: System report (file: /skills/.system/report/SKILL.md)"));
    assert!(catalog.contains("### How to use skills"));
    assert!(!catalog.contains("SECRET_BODY"));
    assert!(!catalog.contains("diagnostics"));
}

#[test]
fn native_catalog_handles_disabled_skills_and_validation_errors() {
    assert_eq!(render(&[]), None);
    assert_eq!(
        render(&[file("private", "---\ndisable-model-invocation: true\n---")]),
        None
    );
    for (content, diagnostic) in [
        (
            "---\nname: null\n---",
            "Skill name must be a nonempty string.",
        ),
        (
            "---\ndescription: []\n---",
            "Skill description must be a string.",
        ),
        (
            "---\ndisable-model-invocation: null\n---",
            "disable-model-invocation must be a boolean.",
        ),
        (
            "---\n!!set {one, two}\n---",
            "Skill frontmatter must be a mapping.",
        ),
        ("---\nname: a\nname: b\n---", "Invalid YAML frontmatter."),
        ("---\nname: a", "Missing closing frontmatter delimiter."),
    ] {
        let catalog = String::from_utf16(&render(&[file("invalid", content)]).unwrap()).unwrap();
        assert!(catalog.contains("### Skill diagnostics"));
        assert!(catalog.contains(diagnostic), "{catalog}");
    }
}

#[test]
fn catalog_rejects_non_plain_yaml_roots() {
    for metadata in [
        "!!set {one, two}",
        "!!omap [one: two]",
        "[one, two]",
        "false",
    ] {
        let catalog = render(&[Skill {
            name: u("fallback"),
            file: u("/skills/invalid/SKILL.md"),
            content: u(&format!("---\n{metadata}\n---")),
        }])
        .unwrap();
        assert!(
            String::from_utf16(&catalog)
                .unwrap()
                .contains("Skill frontmatter must be a mapping.")
        );
    }
}
