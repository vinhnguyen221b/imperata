# Rules for the tests of a run

Read by the QA Engineer and the Developer before writing a test, and by the Code Reviewer as the bar a run's tests are held to. They hold on every stack; a stack skill adds its own conventions and commands.

A test gives a verdict on an acceptance criterion. It is wrong when that verdict can be wrong: it passes although the behaviour is broken or missing, or it fails although the behaviour is right.

## A test must be able to fail

1. **It fails without the change it covers.** A test that also passes on the code as it was before the run proves nothing about the run. `scripts/lock-tests.mjs calibrate` checks this for each test file; a file that must pass there is listed in the test plan under "Expected to pass without the change".
2. **No assertion that may not run.** An assertion inside a branch or a loop is skipped when the branch is not taken or the list is empty. Assert first that the thing is there, then assert on it. Never `if (items.length) expect(...)`.
3. **No assertion that cannot be false.** `expect(true)`, a value compared with itself, a mock asked for the answer it was just given, a snapshot accepted from the code under test without reading it.
4. **A "must not" comes with a "must".** "The request is rejected" and "the field is not shown" also hold when the feature does not exist. Pair every negative check with a positive one on the same feature, so that a missing feature fails.
5. **No failure swallowed.** No `try`/`catch` round an assertion, no retry that turns a failure into a pass, no skip, only or ignore marker (the test lock reports them), no assertion switched off by an environment variable.

## A test must check the criterion, not the code

6. **One expectation per test,** named with its Test ID and what the criterion expects, so that a failure says which criterion broke. A precondition may be asserted first. A test over the cases of one criterion counts as one test, when each case runs and fails by itself and its failure names the case.
7. **Behaviour is checked by running it.** Call the function or the API, drive the page, read the state that results. A test does not search the application's source text to show what the application does.
8. **Through what the criterion names.** Reach the behaviour through the public contract, and a page through what a user perceives (role, label, text): not through a private helper, an internal name or a class that only this implementation has. Another correct implementation must pass.
9. **Nothing the criterion does not require.** Accept every outcome the criterion allows, and do not assert an incidental value: an example figure, a wording or an order that nobody specified. A requirement you find missing is a question for the owner (`NEEDS_DECISION`), not a test.
10. **A stand-in behaves like the real thing.** A mock, stub or fake answers as the real dependency does wherever the code relies on it. Otherwise the test shows only that the code works against the mock.

## A test must give the same verdict every time

`scripts/lock-tests.mjs calibrate --suite` runs the whole suite several times on the same code; one run that fails keeps the run out of review.

11. **Wait for the state, not for the clock.** Poll or await the condition the test is about: the response arrived, the element is shown. Never sleep a fixed time.
12. **Nothing left to chance.** Fixed synthetic data; no dependence on the current date, a random value, the network or the order in which tests run.

## Changing and reviewing a test

- A test is corrected only when it contradicts an acceptance criterion or breaks a rule above, and the correction says which. It is never loosened to make it pass.
- The Code Reviewer reports a test only when it breaks one of these rules, or when an accepted criterion, or a case of one, has no test and no accepted gap. A finding names the file and line, the rule, what shows that it is broken, and the fix. The style of a test is not a finding.
