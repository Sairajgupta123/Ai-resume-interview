# Employer authorization and tenant-isolation review

## Review scope

This review covers the employer login/session model, candidate interview ownership, and the employer-facing API routes on the current development branch. It is an architecture and access-boundary review, not a claim that multi-tenant isolation has already been implemented.

## Current authorization model

- Employer access is a single shared account configured through `EMPLOYER_USERNAME` and `EMPLOYER_PASSWORD`.
- `lib/auth.ts` issues an HMAC-SHA256-signed, HttpOnly-cookie session using `SESSION_SECRET`; sessions expire after 12 hours.
- Login attempts are rate-limited through the `LoginAttempt` table.
- The session identifies the configured shared username only. It does not identify a person, employer organization, organization membership, role, or tenant.
- `Interview` records have no `organizationId` or employer-owner relation.
- Therefore, any authenticated employer account currently has the same global access to all interviews. This is a single-employer deployment model, not multi-tenant authorization.

## Protected employer data surfaces reviewed

The following routes require the shared employer session before returning or changing employer data:

- `GET /api/sessions` — lists all interviews.
- `GET /api/sessions/[id]` — returns an interview and its transcript/decision history.
- `GET /api/sessions/[id]/recording` and `HEAD` — serve private recording bytes/metadata.
- `GET /api/sessions/[id]/export` — exports interview report, transcript and decision history.
- `POST /api/sessions/[id]/decision` — records employer decisions.
- `POST /api/sessions/[id]/invite` and `POST /api/sessions` — creates or reissues candidate invitations.
- `POST /api/employer/sessions`, `GET /api/employer/analytics`, `GET /api/employer/audit`, and `POST /api/employer/compare`.
- Employer privacy/deletion and retention routes under `/api/employer/privacy/*`.

Candidate-facing access is separate: invitation tokens are stored as hashes, the one-time invitation is exchanged through a POST body, and subsequent candidate requests use a session-scoped HttpOnly cookie. Candidate access is checked against the requested interview ID. Candidate endpoints must continue to avoid returning employer-only decisions, reports, recording storage paths, or other candidates' data.

## Important limitation

The current shared employer session is an authentication gate, not an organization-level authorization decision. Since all interviews are global to that account, adding multiple employer logins without adding ownership and tenant scoping would expose one company's candidate data to another. Do not enable multiple organizations or invite external employer accounts until the target controls below are implemented and tested.

## Target model before multi-company use

1. **Identity:** replace the shared environment-variable login with individual employer identities. Store password hashes using a suitable password-hashing algorithm; never store plaintext passwords.
2. **Organizations and membership:** add `EmployerOrganization` and `EmployerMembership` records. Membership must link a user to an organization and carry a server-validated role such as owner, admin, recruiter, or reviewer.
3. **Tenant ownership:** add a required `organizationId` relation to every employer-owned interview and related employer data. Backfill existing interviews to one explicitly created legacy organization before making the relation required.
4. **Session claims:** sign a session containing a stable employer user ID and session version/expiry. Resolve active organization membership server-side on each request; do not trust an organization ID supplied only by the browser.
5. **Scoped data access:** every employer list, detail, export, comparison, analytics, audit, recording, invitation, decision, retention, and deletion query must be constrained by the authenticated organization. For ID-based operations, first prove the interview belongs to that organization. Return a consistent not-found response for foreign-tenant IDs to avoid disclosing their existence.
6. **Audit attribution:** attach actor user ID and organization ID to employer decision and security audit events. Preserve the current minimal recording-access event semantics; a prepared response is not proof of viewing.
7. **Role authorization:** enforce server-side permissions for inviting candidates, reviewing reports, making decisions, exporting data, managing members, and approving/executing deletion requests. Authentication alone must not imply every permission.
8. **Migration safety:** use a staged migration with a backup, explicit legacy-organization backfill, integrity checks, and rollback plan. Do not create a nullable organization field and leave unowned interviews silently accessible.
9. **Verification:** add integration tests with two organizations proving that cross-tenant list, detail, recording, export, comparison, decision, audit, invitation, analytics, and deletion access is denied. Include role-matrix tests and candidate-invitation regression tests.

## Recommended implementation order

- Phase A: finalize the data model and migration/backfill plan while retaining the current single-employer login.
- Phase B: introduce employer identity, organization, membership, and session identity.
- Phase C: apply tenant scoping to all employer routes and add two-tenant integration tests.
- Phase D: add role-based permissions and actor-attributed audit history.
- Phase E: only after all checks pass, enable organization onboarding and multi-company production use.

## Current release decision

Keep the application in its current single-employer mode. The current authenticated dashboard is suitable for controlled development/testing with one configured employer account, but it is not ready for independent companies to share one deployment. No production multi-tenant claim should be made until the target model and cross-tenant tests are complete.
