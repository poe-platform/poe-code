# Transition corpus QA

Scope: the transition subset implementation only. Execute bounded, disposable QA manually; do not run the whole pipeline, download files, add corpus dependencies to unit tests, or redistribute assets. Product behavior accepts explicit bytes. Host reads below belong only to QA.

## Procedure

1. Read the corpus manifest and use only its existing cache paths. Stream SHA-256 of each file and compare with the recorded digest before opening its ZIP.
2. Inspect slide XML members in memory with Python standard-library ZIP/XML readers, enforcing the manifest 32 MiB per-XML-member bound. Inventory transition, Morph and sound nodes by expanded namespace name; inspect transition ancestors to distinguish MCE branches from separate effective transitions.
3. Once the SDK is available, pass representative original input bytes to the transition reader. Compare duration and advance metadata against independently parsed XML.
4. Make an unrelated supported edit in memory, reopen returned ZIP bytes, and compare transition-bearing slide XML and relationships against input. Reduce any validated defect to an original fast unit regression; never copy document assets or wording.
5. Do not create output artifacts or delete shared corpus inputs needed by another campaign. Record actual results and limitations here.

## Executed inspection (2026-09-13)

All 14 manifest binaries exist and their SHA-256 digests match. Only slide XML was decompressed for this scan; media was not decompressed. XML member size checks passed. This is XML/ZIP inspection, not schema validation or visual rendering.

| Cached file | Verified SHA-256 |
| --- | --- |
| `IXPE-Presentation-Template.pptx` | `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c` |
| `CERN-intro-2025-v2.pptx` | `62ab3f5c42e7a967af1f4cfc07cede3909a88b6c75f8432231e83a6e8d17e134` |
| `CERN-job-opp-250925.pptx` | `85cc7b338a11b9d1a9dfcaaaa504bf21ab643e4c30004a478152f390ee9f5f1d` |
| `ISOLDE-drawings.pptx` | `d684281d2f8731787951a0c568a1f6acb8bdbc6cf5de2a64c97c358af1fa92c7` |
| `SEWP_Training_Slides_May 2026.pptx` | `83a63c49e09d89f7804a6dcad64fb9d61bc3401dc10d3351cc5222821c85bcf7` |
| `SEWP_Provider_Training_Slides_05_12_25.pptx` | `3695972c410e1a8862f72962d706bdfde1e680a144b48bf2bb9bb8095ecca3b5` |
| `SEWP_CH_Training_Presentation_05_12_25.pptx` | `c0655717508915de86efcfb1d027d9b60ce382331d66c3d6f22b7dcbfc6f6614` |
| `WWL-template-1slide.pptx` | `0c728ea3fd2ab76906247931fcb5c966074d21e804187893d954cc913cc89689` |
| `slides-public-engagement-DEC-2021.pptx` | `0377c715798aa4462b826670dd0bb2bcf1b3fca98cdf546b1f326cdd6ffd397e` |
| `CluestotheCosmos.pptx` | `74e3f1b48b7ea6892a8c0400e02eb8f6b5d939212e83216118d3958757f06a2d` |
| `20120418_Jedlovec_SuomiNPP.pptx` | `884611296fe0c5f36b2e4e3abf0ae7b16124879434834c45dadb457bdf8d9a01` |
| `earth-system-media-large.pptx` | `f1129e557eed26e1b84aaf3f1f422449ecb7b4e60c8f99dad42fceefeb1097a1` |
| `global-outlook-2026.pptx` | `f05d30f82013e31ecf3d6705d34c83e26a1d6b44e5f3e9f608b98b6c8e4ee582` |
| `data-visualization-course.pptx` | `ce874bc9782258175b84f5e438123552b78c993e0add9015f35d8ca2dd5c45d2` |

### Findings

- The corpus contains 92 physical `p:transition` elements across six presentations. Paired MCE branches count separately; this is not an effective slide-transition count.
- `SEWP_Training_Slides_May 2026.pptx`, slide 1, has a slide-root `mc:AlternateContent` with `mc:Choice Requires="p14"` containing fade, `spd="med"` and `p14:dur="700"`; its fallback contains fade and speed without a duration. The two other SEWP presentations repeat this form on 16 and six slides respectively. A reader inspecting only immediate slide children misses these transitions.
- `slides-public-engagement-DEC-2021.pptx` includes MCE fade with `p14:dur="1500"` (slide 18), `p14:dur="2000"` (including slide 23), and `p14:dur="700"`. These values are milliseconds; speed is a separate legacy attribute.
- That presentation contains explicit `advTm="0"` on nine paired transitions and `advClick="0" advTm="0"` on two further paired transitions, including slide 27. Zero timed advance must remain distinguishable from absence. Slide 22 has a direct fade with `thruBlk="1"` and legacy slow speed.
- The CERN introduction includes three empty direct transition elements. The Suomi presentation includes one empty transition and one with `spd="slow" advClick="0"` (slide 13). An empty transition is distinct XML from no transition.
- Transition element namespace is `http://schemas.openxmlformats.org/presentationml/2006/main`. Duration namespace is `http://schemas.microsoft.com/office/powerpoint/2010/main`; MCE namespace is `http://schemas.openxmlformats.org/markup-compatibility/2006`. Prefix spelling must not determine behavior.
- No Morph or transition sound elements appeared in this slide scan. No cut, push or wipe effect children appeared. Those paths require original unit fixtures rather than claims of corpus coverage.

## SDK execution

Executed the supported text reader and literal text replacement SDK on the May training presentation and public-engagement presentation, with explicit input bytes and explicit QA limits (64 MiB archive/input/member, 128 MiB expanded, 5,000 members, 32 MiB XML, depth 256, 5,000,000 XML nodes, 50,000 relationships). Both changed exactly one text match in memory.

Independent Python ZIP/XML inspection of input and result confirmed equal transition-bearing slide-root subtrees (including complete MCE wrappers and both branches) and byte-identical payload hashes for every relationship part. This checks semantic XML retention, not exact serialization of transition subtrees. No returned presentation was written to disk.

The first public-engagement attempt used an entire SDK text segment, which contained a control separator rejected by the literal replacement validator. Retrying with a valid original eight-character substring succeeded. This was a QA input correction, not a validated transition defect.

The new `readTransitions` reader was executed on both original inputs. Independent XML inspection supplies the expected counts: the May training file reports 18 slides with one unsupported transition record; the public-engagement file reports 28 slides with 21 unsupported transition records (20 MCE-wrapped effects plus one direct fade through black). Both assertions passed. MCE wrappers are explicitly preserve-only in this subset; duration and advance metadata inside their branches are not exposed, so these QA results do not claim effective-branch interpretation. Slide 22's direct through-black fade reports default click advance true.

Corpus coverage does not replace original tests for sound, Morph, cut/push/wipe, direction, or invalid authored settings. No visual renderer ran, so rendered animation fidelity is unverified. No new downloaded binary, permanent script, product fixture or presentation output was created. All original manifest binaries remain available for other active campaigns.
