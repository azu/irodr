---
name: land
description: >-
  Land explicitly requested changes in azu/irodr through a GitHub pull request
  and verified squash merge to master. Invoke only when the user requests
  landing or merging, including Land Changes or /land, not merely for review,
  preparation, passing checks, or installing this skill.
metadata:
  delta-action: land
---

# Land irodr changes

## Intent and scope

This skill applies only to `azu/irodr`. An explicit landing request authorizes
preparation, commits, topic-branch publication, PR creation, and merging through
the workflow below. `/land` and accepting an offer to run this installed skill
are explicit landing requests. Proceed without asking for the same permission
again. Installing this skill alone does not authorize execution.

Use the attached Delta worktree, not the user's primary checkout. Land only the
requested change; preserve unrelated staged, unstaged, and untracked work.
Never publish secrets, disable signing or hooks, force-push, rewrite shared
history, bypass protection, or change repository settings to make landing pass.
If scope is genuinely ambiguous, ask one focused question before proceeding.

When the user requests landing this skill first and another change afterward,
land them as separate PRs in that order. Stage only the skill for the first PR;
keep the other changes out of its commits. Carry the remaining work forward
without discarding it, and create the second PR from the updated target.

## Preflight

1. Read applicable `AGENT.md`/`AGENTS.md`, current contribution instructions,
   templates, and the relevant change. Inspect:

   ```sh
   git --no-optional-locks status --short --branch
   git diff
   git diff --cached
   git remote -v
   git log -8 --oneline
   ```

   Identify existing relevant commits as well as uncommitted work. Do not stage
   all files blindly or replace the user's partial staging. Check for unresolved
   merge markers and Git operations before starting another operation.

2. Verify the publication remote is GitHub `azu/irodr`; normally it is `origin`.
   Never push to Delta's `local` backlink. Verify the default branch, currently
   `master`, and the intended PR base. If the destination differs from this
   scope, stop and clarify instead of silently choosing `main` or another repo.
   Check `gh auth status` without displaying credentials and confirm Git push
   access. Authentication and tools can differ between machines.

3. Inspect destination settings using `gh api` / `gh pr view`:
   - Repository identity, default branch, viewer permissions, and whether squash
     merging is allowed.
   - `repos/azu/irodr/branches/master` and
     `repos/azu/irodr/rules/branches/master`.
   - Applicable branch protection and required checks/reviews when protected.
   - For an existing PR: head SHA, base, draft state, review decision, merge
     state, and check results.

   During setup, `master` was unprotected, the applicable-rules endpoint returned
   no rules, and squash merges were allowed. These are observations, not permanent
   exemptions. The token could not read the branch-protection administration
   endpoint: do not interpret a 403 as "no requirements." An explicit unprotected
   branch response plus successfully retrieved empty applicable rules can establish
   that no branch rules apply. Otherwise, if requirements cannot be established,
   stop and explain the missing access. Never use `gh pr merge --admin`.

4. Follow the contribution policy in `README.md` ("Contributing"): a feature
   branch and pull request, rather than a direct target-branch push. Use a fork
   if upstream topic-branch push permission is unavailable; stop if no authorized
   publication destination is available. Respect `CODE_OF_CONDUCT.md`. For a
   newly discovered nonpublic vulnerability, follow the inherited security policy
   at `https://github.com/azu/.github/blob/master/SECURITY.md` before publishing
   sensitive details.

   No additional CLA, mandatory human-authored submission text, changelog entry,
   or fixed review count was found during setup. Recheck current policies and
   templates; enforce any applicable unmet requirements, including their
   conditions and exceptions. Do not invent requirements or ask again about
   requirements already satisfied. Describe behavior accurately in affected
   documentation; do not claim tests that were not run.

## Prepare and verify

Use the Node version in `.node-version` (24.14.1 at setup) and pnpm from
`package.json#packageManager` (10.34.5 at setup). CI reads `.node-version` through
`voidzero-dev/setup-vp`; local verification does not replace CI. Do not silently use
whichever Node happens to be first on `PATH`.

Let the runtime manager read the project version files rather than overriding
the version in each command. For mise, the existing
`settings.idiomatic_version_file_enable_tools` setting should include `"node"`
so it reads `.node-version` automatically. Verify the active versions:

```sh
node --version
pnpm --version
```

Use the ordinary package commands below when those versions match. If the
non-interactive terminal has not activated mise, prefix commands with
`mise exec --` to use its project-selected versions, without an explicit
`node@...` override. Sources: `.node-version` and `package.json#packageManager`;
the optional wrapper syntax was checked against `mise exec --help`.
Ask before installing global tooling or changing the user's external configuration.

1. Fetch the verified publication remote. Reuse the relevant topic branch/PR
   where appropriate; otherwise create a descriptive `feature/...` branch,
   including when the work started as uncommitted edits on `master`. Check the
   entire base-to-head diff so old or unrelated commits do not slip into the PR.
   Do not discard existing work or stash it without a clear recovery plan.

2. Install project dependencies when needed:

   ```sh
   pnpm install --frozen-lockfile
   ```

   Source: `.github/workflows/test.yml` installs with `vp install --frozen-lockfile`
   (Vite+ runs the pnpm version from `package.json#packageManager`);
   `package.json#packageManager` and `pnpm-lock.yaml` define the dependency state.
   `--frozen-lockfile` prevents incidental lockfile changes.
   `package.json#scripts.prepare` runs `vp config --no-agent`, which installs the
   Vite+ hook dispatcher for `.vite-hooks`. Preserve that hook behavior. If the
   manifest and lockfile are inconsistent, fix only the intended dependency
   change and rerun verification; do not bypass the failure.

3. For code, dependency, or build/test configuration changes, run:

   ```sh
   pnpm run check
   pnpm test
   pnpm run build
   CI=true pnpm run test:e2e
   ```

   Sources: `.github/workflows/test.yml` runs `vp check`, `vp test` and `vp build`
   (job "Check, unit test and build") and `vp run test:e2e` (job "Integration tests").
   `package.json#scripts.check` runs `vp check` (Oxfmt, Oxlint with type checking);
   `package.json#scripts.test` runs the Vitest unit tests once (`vp test` does not watch);
   `package.json#scripts.test:e2e` builds with `--mode e2e` and runs Playwright against
   the fake APIs in `e2e/fake-api`. `CI=true` makes Playwright start fresh servers.
   Playwright needs Chromium (`pnpm exec playwright install chromium`, or set
   `PLAYWRIGHT_CHROMIUM_EXECUTABLE`).

   For skill/documentation-only changes, local verification can instead check
   syntax, links, command references, frontmatter, and the scoped diff. This
   exception is local only: required remote checks still must pass.
   Check `git diff --check` for every change.

   If local verification fails due to an environment issue, use the declared
   runtime and retry. Report genuine unavailable prerequisites or failed checks;
   do not label them passed, replace tests with mocks, or weaken the checks.

4. Stage only the intended paths/hunks. Use an English conventional commit
   subject (`feat:`, `fix:`, `docs:`, `chore:`, etc.), following existing history.
   Use a non-interactive commit:

   ```sh
   GIT_EDITOR=true git commit -m "type: concise description"
   ```

   Preserve the user's signing configuration (SSH commit signing was enabled at
   setup). Never use `--no-verify` to bypass `.vite-hooks/pre-commit`, which runs
   `vp staged` (the `staged` block in `vite.config.ts` formats and lints staged files)
   and `vp test`.
   Inspect the resulting commit and any hook changes. Verification must cover
   the final contents, not the pre-hook or earlier version.

## Publish, check, and merge

1. Push the topic branch to the verified publication remote, never to `local` or
   directly to `master`. Use ordinary non-force pushes. On rejection, inspect the
   cause; do not bypass permissions through API-based Git writes.

2. Reuse an existing PR with matching scope/base, or create a ready-for-review
   PR targeting `master` using `gh pr create` with explicit repository, base,
   head, title, and body. Pass text using non-interactive options; if using a
   body file, write it under the current scratch directory. Follow any template.
   Include the problem, actual behavior, verification results, and relevant issue
   links without inventing issue requirements. A draft PR must become ready and
   satisfy its review requirements before merging.

3. Refresh the target. When integration is needed, merge the latest target into
   the topic branch using `GIT_EDITOR=true git merge origin/master` (substitute
   the verified remote if different). Do not rebase published history.

   **Conflict preference: resolve automatically when intent is clear.** Preserve
   both sides' intended behavior and unrelated work. For ambiguous behavior,
   unsafe changes, or uncertain ownership, stop and ask. Do not blindly choose
   ours/theirs or delete a lockfile to force resolution. After any resolution or
   other code change, repeat applicable local verification, commit non-interactively,
   push normally, and obtain new CI/review results.

4. Verify all applicable required checks and reviews for the exact current head.
   Always require the repository's `test` workflow, including every current
   job ("Check, unit test and build" and "Integration tests"), even if branch
   protection does not mark it required. Inspect both workflow runs and PR check/status results.
   Check a Netlify deploy preview when present; do not mistake neutral informational
   Netlify checks for a successful build.

   `gh pr checks PR --repo azu/irodr --watch --interval 10` can wait for checks;
   bound each watch with the terminal timeout and re-query on timeout. A successful
   CLI exit or empty list is not enough: confirm the expected workflow actually
   ran for this head/integration, completed, and passed. Use `gh run view` and
   check details as needed to verify SHA, event, conclusion, and result URL.
   Pending, failing, cancelled, missing, stale, or unverifiable required checks
   block landing. Informational skipped/neutral checks do not substitute for the
   required tests. Do not override requested changes or required reviews.

5. Immediately before merging, re-read head SHA, target SHA, mergeability,
   required reviews and checks. If either relevant SHA changed, reassess and
   obtain verification for the new changes/integration.

   Squash merge with an exact-head guard:

   ```sh
   gh pr merge PR --repo azu/irodr --squash --match-head-commit VERIFIED_HEAD_SHA
   ```

   Replace the uppercase arguments with verified values. Flags were checked
   against `gh pr merge --help`. This is the approved workflow, not a claim that
   squash is mandated by repository policy. If squash is no longer permitted,
   stop and ask rather than silently changing strategy. If a merge queue becomes
   required, honor it without `--admin` and wait for the actual merge and all
   required queue checks; entering a queue is not completion.

## Verify destination and report

Confirm the PR is `MERGED` into the intended repository and `master`, retrieve
its actual merge commit SHA, fetch the destination, and verify that commit is
reachable from the remote target. Account for squash commits having a different
SHA from the topic branch.

Confirm the target-branch `test` workflow passed for the landed commit, not
merely for a prior PR revision. Source: `.github/workflows/test.yml` runs on both
`push` and `pull_request`. If post-merge CI fails or cannot be verified, explicitly
say the change has landed but destination verification failed; do not pretend it
is unmerged or automatically revert shared history.

Do not reset the user's checkout, discard remaining work, or delete branches
containing other work. Leave the topic branch available unless cleanup was
requested. Finish by checking working-tree state and explaining any remaining
changes. A prepared commit, branch push, open PR, queued merge, or passing local
build is not successful landing.

When running in a subthread with `report_subthread_status` available, report the
verified outcome to the parent; otherwise report directly in this conversation.
Use `success` only after destination and CI verification. Use `failure` for a
failed attempt or genuine blocker, describing whether landing occurred.
Continue safe recovery when permitted and report an updated result after
verification. Do not use this tool for skill installation or routine progress.

Keep the title to a few sentence-case words and the description to one short
line. Link the short commit SHA and actual CI result using verified URLs; omit
unavailable links rather than constructing fictional ones. Examples of wording:

- Success: `Landed on master` — linked short SHA, then linked `CI passed`.
- Failure before merge: `Blocked by CI` — linked failed run and commit, then
  `Not landed.`
- Publication failure: `Push blocked` — state the required access and that the
  change has not landed.
- Failure after merge: `Post-merge CI failed` — linked landed SHA and failed run,
  explicitly saying it is already on `master`.

Ask necessary questions in the conversation, not in a status event.
