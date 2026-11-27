# Clarification log — <runId>

One row per question. A question is closed only by a person's decision; a proposal from an agent is not a decision.

| ID | Question | Why it matters | Affects (BR / AC) | Security-sensitive area | Options and their consequences | Needed before | Decision | Decided by | Decided at | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q-01 |  |  |  | no | (a) ; (b)  |  | OPEN |  |  |  |

`Evidence` is the pull request whose merge approved the decision (pull-request mode) or the message or file where the owner wrote it (local-record mode).

- `Question` and `Why it matters`: plain words a product owner understands without reading the documents. `Why it matters` says what changes for users or the business depending on the answer; IDs go in `Affects`.
- `Options and their consequences`: one option per `(a) …; (b) …`, each with what follows from it. Each option states the value the owner takes with it; none leaves a value for the owner to fill in, as "a number you name" does. An example common to every option may come first, as a sentence of its own before `(a)`. The run board turns the options into choices the owner can pick, with that sentence above them, and the owner can write another answer on the card; free text stays free text.
- `Needed before`: the gate the question must be decided before: `businessApproval` when the answer changes an acceptance criterion, `planApproval` when it changes only the design, a later gate otherwise. The run board puts questions needed before the current gate first and lists the others as able to wait.
- `Decided by`: while the question is open, who is expected to decide; once decided, who decided.
- While open, `Decision` is `OPEN`, optionally followed by ` — <note>`.
- `Security-sensitive area`: the area the question settles when the rules for every agent or `.orchestra/project.md` name it security-sensitive; `no` otherwise.
- At most five questions needed before one gate are open at a time, and up to ten when each one past five is in a security-sensitive area; the run board flags more. A point in such an area that no default settles stays a question past five; it is never made an assumption to stay under the limit. A point that a reasonable default settles is not a question: it is a row of "Assumptions" in the specification, approved with it.

## Proposals not yet decided

Recommended defaults from the Business Analyst. They carry no authority until a row above records a decision. One bullet per question, in the form `- <ID>: <recommendation> — <reason>`; the run board shows it on that question.

- Q-01:
