# Image, movie and OLE returned model evidence

Status: bounded implementation receipt, 2026-09-13. This does not establish whole-public-API coverage.

The API/test audits and inventories were read. The returned-interface inventory includes `_MediaFormat` and `_OleFormat`; their underscores do not exclude them. Target public types are `MediaFormat` and `OleFormat`. Eight focused inventory unit rows cover movie type/media-format/poster (including absence) and OLE blob/program-ID/icon flag; five BDD rows cover movie preconditions and OLE variations. Original tests below cover their observable interface behavior, with explicit differences below rather than claiming source-runtime equivalence.

| Public behavior               | JavaScript implementation and original evidence                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Picture.image                 | Synchronous Image snapshot from owned package bytes; content type retained; returned blob copies cannot mutate the package                                                          |
| Movie.shape_type / media_type | MEDIA (16), MOVIE (3); only DrawingML videoFile under picture nonvisual properties creates Movie                                                                                    |
| Movie.poster_frame            | Image or null when no embedded poster reference exists                                                                                                                              |
| Movie.media_format            | Public MediaFormat with live element, parent Movie, and owning package part                                                                                                         |
| GraphicFrame.ole_format       | Public OleFormat with live graphicData element, parent frame, owning part, prog_id, show_as_icon and isolated blob                                                                  |
| OLE absence                   | Missing progId or file relationship gives null; linked objects give null blob and never resolve or execute external targets; omitted showAsIcon gives false                         |
| Inherited picture behavior    | Geometry, name, rotation, line/shadow interfaces, four crop getters/setters and package ownership retained                                                                          |
| add_picture                   | Async BinaryInput admission, explicit Length position, optional native/aspect-preserving dimensions; same addImage engine as images.add                                             |
| add_movie                     | Async explicit inert video bytes, Length rectangle and trailing {poster_frame_image, mime_type}; same addMedia engine as media.add                                                  |
| add_ole_object                | Async explicit inert bytes, string or registered PROG_ID, Length position and trailing {icon_file,width?,height?,icon_width?,icon_height?}; same addOleObject engine as objects.add |
| Group insertion               | Shared insertion followed by XML reparenting and nested group extent recomputation; existing group ownership retained                                                               |

`media-public-model.test.ts` tests returned members independently of top-level documentation, isolated blobs, missing values, foreign lookalikes and inherited formatting. `media-public-insertion.test.ts` tests shared engine insertion, memfs save/reopen, inherited group insertion, registered program defaults, path rejection and poster snapshot ownership before asynchronous admission. Source fixtures, native programs and downloaded binaries are not used.

## Exact language/security mappings and drift

The [pinned movie source](https://raw.githubusercontent.com/scanny/python-pptx/278b47b1dedd5b46ee84c286e77cdfb0bf4594be/src/pptx/shapes/picture.py) confirms that poster absence returns None and media_type is unconditionally MOVIE. JS uses null and the existing neutral enum. Crops accept signed fractions, including values above one: the shared XML engine receives explicit signed-fraction policy from model setters. The existing images.set command retains its positive-visible-area policy. This difference is deliberate, not a second XML editor.

The [pinned OLE XML source](https://raw.githubusercontent.com/scanny/python-pptx/278b47b1dedd5b46ee84c286e77cdfb0bf4594be/src/pptx/oxml/shapes/graphfrm.py) resolves apparent return-type drift: showAsIcon is false when the object exists but its flag is omitted; null represents no object. The public frame getter rejects a frame without OLE. Missing r:id produces null bytes. JS returned OleFormat.parent is the public owning frame, retaining a usable route to its live element and package part; the source internally supplies its shape collection owner.

Explicit capabilities replace ambient filesystem paths. Reads/snapshots remain synchronous after package admission; insertion returns Promise and checks revision before applying changes. Caller-supplied Uint8Array movie posters/icons are copied before the first await. No movie playback, OLE activation, program discovery or implicit network occurs.

Movie insertion requires an explicit poster and MIME type; no bundled speaker artwork or `video/unknown` inference is supplied. This is a visible bounded capability mapping. Registered PROG_ID values retain domain package-type/default-size behavior; custom strings remain opaque program IDs. Icons are explicit bytes rather than host or bundled reference assets. Python keyword arguments map to trailing typed option objects, binary immutable values to owned Uint8Array snapshots, and None to null. Raw XML/package access uses existing bounded package/element interfaces, not a dependency XML runtime.

Remaining boundaries: OLE graphicData with complex AlternateContent selection, general audio-specific model handles, the complete ImagePart factory/relationship graph and all independent public inherited-member tests are not claimed complete by this receipt. General unknown graphic frames retain the existing implementation boundary. Historical inventory labels are not rewritten to imply complete support.

Validation: original red failures were observed before each behavior fix; focused model/insertion and existing slide/presentation/image-formatting suites passed. Integration root records maintained package-wide check and commit outcomes separately.
