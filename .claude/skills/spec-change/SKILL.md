---
name: spec-change
description: Use when adding or changing API behavior (a business rule, endpoint, status code, permission or validation). Guides the spec-driven steps - update docs/SPEC.md, write a failing test named by rule ID, make the smallest change, verify, review, commit.
---

# Spec change

Follow the steps in order. Do not write production code before the test in step 2 fails for the right reason.

1. **Spec.** Find the rule in `docs/SPEC.md` (R1, R2, ...). Change it, or add the next free ID.
   - Keep the "Source", "Who is hurt if this breaks" and "Test" columns filled in.
   - Update sections 4-8 (permissions, data model, API, errors, seat safety) if the change touches them. Add new assumptions to section 11.
2. **Failing test.** Add or change a test whose name starts with the rule ID, for example `R4 rejects registration after the event starts`.
   - Database behavior goes in `test/integration/`. Pure logic (policy, validation) goes in `test/unit/`.
   - Run only that test (`npm test -- -t "R4 "`; the space stops `R1` from also matching `R10`). Confirm it fails for the expected reason, not because of a typo or setup error.
3. **Code.** Make the smallest change that makes the test pass.
   - Business rules live in `src/modules/*/service.ts` and in SQL.
   - Permissions live only in `src/auth/policy.ts`.
4. **Verify.** If routes or schemas changed, run `npm run openapi` first and keep the regenerated files. Then run `/verify`.
5. **Review.** For changes under `src/`, `migrations/`, `test/` or `web/`, run `git status --short` and `git diff HEAD`. Give that output to the `spec-reviewer` agent. Fix what it finds, or explain why it does not apply.
6. **Commit.** One commit for this change, for example `feat: freeze registrations once an event starts`, with the rule ID in the body.
