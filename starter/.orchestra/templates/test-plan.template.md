# Test plan — <runId>

Derived by the QA Engineer from the approved acceptance criteria and business invariants, not from the Developer's tests. The tests follow `.orchestra/test-rules.md`.

## Matrix

| Test ID | AC | Scenario | Category (unit / API / E2E / negative / concurrency / isolation) | Expected | Test file | Mandatory |
| --- | --- | --- | --- | --- | --- | --- |
| T-01 | AC-01 |  |  |  |  | yes |

The matrix grows task by task: the QA step of a task adds the rows of the criteria that task names, and leaves the rows of earlier tasks as they are. Every AC has at least one test, and so has every decision of the technical plan that names a security-sensitive area: its ID goes in the AC column, beside any criterion (`AC-03, ADR-05`). Where a criterion has cases, every case is named by a test, alone (`AC-03.2`) or in a range (`AC-03.1..AC-03.4`); a test over a table of cases is one row with that range, and naming the criterion alone covers none of its cases. Every rule that rejects something has a negative test. `Mandatory` is `yes` for a test its criterion is not decided without; in a bug run the test that showed the bug is mandatory whatever this column says. From review on, `scripts/validate-gates.mjs` rejects a run in which a mandatory test is not `PASSED` in the test report, unless its Test ID is listed under "Not covered" with who accepted the gap. Every test fails without the change it covers: the Orchestrator checks that per test file with `scripts/lock-tests.mjs calibrate`.

## Expected to pass without the change

A test file of this run that must pass on the code as it was before the run: it guards behaviour that existed before and must not break, or it is a support file that holds no test. Calibration reports any other file that passes there. Leave the table empty when there is none.

| Test file | Why it passes without the change | AC or invariant it guards |
| --- | --- | --- |
|  |  |  |

## Not covered

| AC, decision or risk | Reason | Who accepted the gap |
| --- | --- | --- |
|  |  |  |

A gap is accepted by the owner, never by an agent. The QA Engineer leaves "Who accepted the gap" empty; the Orchestrator fills it with the owner's name and where the decision is recorded. From review on, `scripts/validate-gates.mjs` rejects a run with an acceptance criterion, or a case of one, that has no passed test in the test report and no accepted row here. A row that names a criterion accepts the gap for all its cases. A row names a criterion, a case, a decision or a Test ID. What the calibration shows, such as whether the tests fail without the change, is no gap, and a remark on how the tests were written belongs in the QA Engineer's report: the validator warns about a row that names none of them and that nobody accepted, and the run board lists every row nobody accepted.

## Environment

- Commands:
- One test file (from the stack skill; `{file}`, `{dir}` or `{name}` where the file goes):
- All tests (from the stack skill; calibration runs it several times):
- A fresh checkout needs, before that command works (install command, or paths to link; `none`):
- Fixtures and seed data (synthetic only):
- Tools unavailable in this session:
