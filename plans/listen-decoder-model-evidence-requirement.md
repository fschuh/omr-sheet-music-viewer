# Requirement for a decoder and model-evidence plan

**Emitted by:** Task 29 of `plans/listen-matcher-calibration-plan.md`, August 25,
2026, as that task's own output. **Status:** open requirement, not a task.

This is a written requirement for a *new* plan, not a task inside the calibration
plan. Model work is an explicit non-goal there, and the residual this document
carries cannot be addressed by any threshold the matcher-profile registry can
hold. It is emitted with round two's production decision — outcome
`round-two-grid-produced-no-eligible-improvement`, reason `no-ablation-accepted`,
default retained at `baseline-v1` — and it would have been emitted alongside a
promoted profile too, because shipping a safer threshold does not resolve a
missing re-onset.

It deliberately does not name Task 21 as the next step. Task 21 (confidence
normalization) is reachable only through Task 17, Task 17 requires round two to
have approved an alternative profile, and round two approved none, so that
prerequisite cannot be met. Routing this residual to Task 21 would name a step
nothing can reach.

## The residual, as measured

Two distinct decoder defects are carried, both recorded by Task 22 in
`benchmark-results/listen-bass-qualification-task22.json` and its August 23
corrective-rerun entry in `tools/online_amt/LISTEN_BENCHMARK.md`. They are stated
separately because they are different failures of the same evidence stream, and a
fix for one is not evidence for the other.

### 1. Onset evidence on a bass pitch that was never sounded

The decoder emits a fresh onset on a bass pitch the performance did not play.
`isolated/direct/122` is the triad `[48, 60, 68]` played as `[60, 68]`, and
`isolated/tone/124` is `[56, 68, 75]` played as `[68, 75]`. Each was completed by a
decoded onset on the omitted bass pitch, measuring 0.5267 and 0.5094 — both inside
the predicted `[0.50, 0.60)` corridor, both admitted through the ordinary
fresh-onset path rather than the sustained-completion path. The cross-rendered
counterpart of each fixture decodes no bass onset at all.

The two sides do not separate on a single scalar outside the isolated suite. A
0.60 bass gate is free on the isolated matched pairs — no genuine bass attack
falls below 0.7161 under Direct or 0.9926 under Tone — and not free anywhere else:
on the continuous corpus 15 genuine bass attacks lie inside the corridor and 61
produce no bass onset at all, with weakest genuine onsets of 0.5093 under Direct
and 0.5182 under Tone, while four continuous attacks that do not sound the bass
still decode one at 0.9999. This is why the round-two bass-onset axis was staged
as an experiment and why its grid, having passed on its own terms, still earned no
production axis: a scalar threshold cannot tell the two populations apart.

### 2. No D5/74 re-onset across the first two physically repeated chords

On the repeated target `[62, 74, 82]` in `dynamics-constant/tone/salamander/v05`,
`dynamics-constant/tone/salamander/v13`, and `dynamics-mixed/tone/salamander`, the
decoder emits no onset at all on D5/74 for the attack that physically sounds it.
On the first attack the bass and the top voice both produce onsets above 0.99
while D5/74 produces none, and its sustained evidence is 0.1935, 0.1627, and
0.0958 in the three runs — a three-run limiting minimum of **0.0958**.

Two recorded corrections belong with that measurement. On the *first* attack of
the repeated region the upper voices are repeated from the preceding chord but are
not still sounding: a 420 ms hold at a 1,000 ms interval has been released, and
the decoded active set is empty immediately before the attack. The still-ringing
case is the later exact repetitions, where all three pitches carry. And the case
is a late-advance performance defect, not a safety defect: the recovery is correct
content recovered late, with zero false, skipped, and duplicate advances.

This is the same retrigger limitation the August 14 score-rise experiment could
not correct safely — its best measured candidate created 22 false or duplicate
events to recover two attacks — and not an unclassified threshold symptom.
Re-enabling score-rise retrigger detection remains a standing non-goal.

## What the shipped default carries today

`baseline-v1` recovers the repeated chord only in `v05`, at source distance 2 and
2,220 ms; in `v13` and the mixed run its playhead never arms the chord at all. A
full attack of playhead lag on a repeated chord is therefore current shipped
behaviour rather than a candidate regression. Round two's staged ablations did
show that some searched profiles reach source distance 0 on `v05` and `v13`
through a 0.075 active-target gate below Task 22's limiting minimum, but none was
registrable, none was confirmed, and none reached the mixed run at all — so no
measured profile resolves this, and the round's version-2 confirmation fixtures
remain unobserved.

## The acceptance question

**Can decoder or model evidence expose the first real repeated attack for a
still-ringing required pitch while refusing an onset on a bass pitch that was
never sounded — reaching source distance 0 on the paired corpus without adding
false, skipped, or duplicate advances?**

A plan answering this must:

- Treat both defects together. A change that exposes repeated attacks by lowering
  the evidence required for any onset re-opens the omitted-bass false advance the
  isolated fixtures pin, and a change that suppresses hallucinated bass onsets by
  demanding more evidence pushes the repeated attack further out of reach. Either
  measured alone is not an answer.
- Measure against the same paired corpus and the same per-trace, per-classification
  safety comparison Task 23 froze: no regression is decided per trace and per
  counter, never from a corpus aggregate or a safe/unsafe boolean.
- Keep source distance and attribution delay together, and report the three
  repeated-chord runs separately. A mean over `v05`, `v13`, and the mixed run
  hides the run where the playhead never arms the chord.
- State explicitly whether it reaches distance 0 on all three runs, on some, or on
  none, and carry any remaining distance-zero limitation into the documented known
  limitations of whatever it ships.
- Leave the matcher-profile registry, the fixed matcher policy, and the frozen
  round-two artifact chain untouched. This requirement is about what the decoder
  reports, not about how thresholds read it.

## What this requirement does not license

It does not license another scalar-threshold grid over the existing five axes for
this residual. Round two staged three grids — the round-one grid recomputed
against the version-2 corpus, a refined five-axis family, and a bass-axis cross —
and Task 22's per-pitch qualification record shows why no gate in that family
reaches the missing re-onset: there is no evidence to threshold. It also does not
license a claim that the scalar-threshold family as a whole is exhausted; round
two confirmed no candidate at all, and such a claim would require confirming every
globally safe non-dominated profile needed to support it.
