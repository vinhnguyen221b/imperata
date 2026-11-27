# Feature specification — <runId>

Status: DRAFT until the business approval gate passes.

## Source

- Original requirement: `sdlc/runs/<runId>/input.md`
- Product documents and version:
- Tracker reference:

## Defect

Only in a bug run (`kind: bug` in `run.json`); delete this section otherwise.

- What happens:
- What should happen, and the source that says so (a BR, an accepted AC, a product document):
- Steps to reproduce:
- Where it was seen (version, commit or environment):
- Must stay as it is: behaviour next to the defect that the fix must not change, each with the rule that states it and the test file of the repository that holds it. `none` where there is none.
- Reproduction: the test file and Test ID the QA Engineer wrote. `evidence/reproduction.json` records that it fails on the code as committed; the specification is approved only once it does.

What should happen is the regression criterion: an AC in the table below, like any other, with its cases. It is the only criterion unless the fix needs another: what a test of the repository already holds is listed under "Must stay as it is" and gets none, since the whole suite runs after the fix.

## Personas and boundaries

- Who uses it:
- In scope:
- Out of scope:

## Business rules

Mark each rule as fact, approved constraint, assumption, proposal or unresolved. A rule of the kind assumption names its row of "Assumptions" in `Source`.

| ID | Rule | Kind | Source |
| --- | --- | --- | --- |
| BR-01 |  |  |  |

## Assumptions

Where the sources leave a point open and a reasonable default settles it, the specification takes the default here instead of asking: the sources, the product's existing behaviour or a common convention point to it. Approving the specification approves every row; the owner decides one instead by requesting changes and naming it. Where the options differ in what users get, the scope or a security-sensitive area of `.orchestra/project.md`, and no default is reasonable, the point is a question in `clarification.md`, not an assumption.

| ID | Assumption | Why it is a reasonable default | Affects (BR / AC) |
| --- | --- | --- | --- |
| A-01 |  |  |  |

## Lifecycle

When the feature changes the states of an entity, draw them here as a Mermaid `stateDiagram-v2`; label each transition with its command or event and the BR it obeys. Draw only what the rules above state. Delete this section when no state changes.

## Acceptance criteria

| ID | Given | When | Then | Business rules |
| --- | --- | --- | --- | --- |
| AC-01 |  |  |  | BR-01 |

Include the negative paths: what must be rejected, and with which reason.

Each criterion is one behaviour a test can decide: one thing a person does, and what can be observed of its result (a response, a stored state, what the user sees), not a quality that needs judgement. What a command prints and its exit code are one result, not two criteria. Split a criterion only where it holds two behaviours or rests on two rules. What cannot be made decidable is a question in `clarification.md`, not a criterion.

### Cases of AC-01

Where a criterion holds for a list of values (the forms a rule accepts, the ones it refuses, the boundaries), the values are its cases, not criteria of their own. Give that criterion one section like this one, with a row for each value and what a test observes for it. The id of a case is the id of its criterion, a point and a number. The first column is `Case` and the last `Expected`; name the ones between after what varies. Delete the section for a criterion without cases.

| Case | Input | Expected |
| --- | --- | --- |
| AC-01.1 |  |  |

A ticket seldom needs more than a dozen criteria. `scripts/validate-gates.mjs` warns above twelve: cases then stand as criteria, or the run holds more than one ticket. From review on it requires every criterion without cases, and every case, to have a passed test in the test report or an accepted gap in the test plan.

## Open questions

Listed in `clarification.md`, at most five needed before one gate at a time, up to ten when each one past five is in a security-sensitive area. This specification cannot be approved while a question that changes an AC is OPEN.
