use agent_skill_config_rust::skill_catalog::{Skill, render};

fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

#[test]
fn catalog_omits_instruction_bodies_and_disabled_entries() {
    assert_eq!(render(&[]), None);
    let files = [Skill {
        name: u("fallback"),
        file: u("/skills/a&b/SKILL.md"),
        content: u(
            "---\nname: ' shared '\ndescription: >-\n  A <description>\n  continues.\n---\nPRIVATE BODY",
        ),
    }];
    assert_eq!(
        render(&files),
        Some(u(
            "<available_skills>\n<skill>\n<name>shared</name>\n<description>A &lt;description&gt; continues.</description>\n<location>/skills/a&amp;b/SKILL.md</location>\n</skill>\n</available_skills>"
        ))
    );
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
