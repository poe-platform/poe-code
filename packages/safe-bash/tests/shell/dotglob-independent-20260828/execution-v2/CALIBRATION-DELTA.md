# Additive baseline calibration revision, 2026-08-28

Attempt baseline-01 used committed executor77b111b9 and accepted099455 STACK
package15aa8d8d only. Preserve its raw capture and original frozen consumers.
21/22 calibration groups completed; B20 failed before product RealFS evaluation:
Node22 permission fences prohibit fs.symlink without unrestricted filesystem
permission. Revision2 moves ONLY the owned fixture setup into the parent; child
read/write restrictions remain unchanged. The escape targets an owned sibling
sentinel, never external user data. This is not a product defect or guard waiver.

Original positive consumer fails TS2322: registered CommandHandler accepts the
general CommandContext whose invoke is optional, not the narrower annotated
ShellCommandContext. Version2 infers the handler context, checks invoke, then
constructs the explicitly typed ShellCommandContext. No any, suppression, new
public API or runtime assertion change. The original fixture/result remain
immutable; the versioned consumer is not an unchanged original pass. The other
four type fixtures/inversions are unchanged.

The second and final permitted baseline attempt retains the same22 calibration
groups/five compiler runs and adds bounded admission controls already presealed
in CALIBRATION-PROTOCOL. No candidate inspection, new build, native invocation,
resource enlargement or stronger unsupported ownership promise is authorized.
