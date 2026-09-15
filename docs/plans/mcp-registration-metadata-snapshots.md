# Registration metadata ownership

Three failing regressions reproduced caller mutation of registered prompt arguments/icons and resource/template annotations/icons/metadata. Three further failures reproduced discovery-result mutation changing subsequent results. The existing tool discovery snapshot case already passed.

Clone declarative prompt/resource/template descriptors on registration and clone their public discovery descriptors on return, matching existing tool behavior. Handler functions and parsed template machinery stay owned by the registry and are not cloned.

Validate registration/result snapshots, prompt behavior, resource matching, URI templates and protocol result conformance. No mutation of caller definitions or emitted objects should change later discovery.
