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

1. **Identity:** the `EmployerUser` schema now includes a revocable `sessionVersion`. A scrypt password-hashing/verification helper and a one-time initial-owner bootstrap command are present. The bootstrap requires an existing organization slug and refuses duplicate usernames; it has not been run against a user database. The shared environment-variable login remains active until individual-identity sessions and all route authorization are implemented and tested. Never store plaintext passwords.
2. **Organizations and membership:** schema foundation is present: `EmployerUser`, `EmployerOrganization`, and `EmployerMembership`. Membership links a user to an organization and carries a role. The pure permission matrix is present, but no authentication or API route consumes it yet.
3. **Tenant ownership:** `Interview.organizationId` is currently nullable as a safe additive schema step. A dry-run-first backfill command now requires explicit `LEGACY_ORGANIZATION_NAME` and `LEGACY_ORGANIZATION_SLUG`, refuses ambiguous databases with multiple organizations, applies organization creation and interview assignment in one transaction, and verifies no interviews remain unassigned. It has not been run against a user database. Back up the SQLite file, inspect the dry-run output, then explicitly apply it. Related employer-owned records reference interviews and inherit their organization scope through that relation.
4. **Session claims:** sign a session containing a stable employer user ID and session version/expiry. Resolve active organization membership server-side on each request; do not trust an organization ID supplied only by the browser.
5. **Scoped data access:** every employer list, detail, export, comparison, analytics, audit, recording, invitation, decision, retention, and deletion query must be constrained by the authenticated organization. For ID-based operations, first prove the interview belongs to that organization. Return a consistent not-found response for foreign-tenant IDs to avoid disclosing their existence.
6. **Audit attribution:** attach actor user ID and organization ID to employer decision and security audit events. Preserve the current minimal recording-access event semantics; a prepared response is not proof of viewing.
7. **Role authorization:** enforce server-side permissions for inviting candidates, reviewing reports, making decisions, exporting data, managing members, and approving/executing deletion requests. Authentication alone must not imply every permission.
8. **Migration safety:** use a staged migration with a backup, explicit legacy-organization backfill, integrity checks, and rollback plan. Do not create a nullable organization field and leave unowned interviews silently accessible.
9. **Verification:** add integration tests with two organizations proving that cross-tenant list, detail, recording, export, comparison, decision, audit, invitation, analytics, and deletion access is denied. Include role-matrix tests and candidate-invitation regression tests.

## Implementation progress

- [x] Add organization, employer-user, and membership schema foundations without changing existing interview ownership.
- [x] Add a tested, deny-by-default role-permission matrix.
- [x] Add fail-closed Prisma query-scope builders and tests proving that missing organization identity cannot produce an unscoped query.
- [x] Add a dry-run-first, transactional legacy-organization backfill command with explicit configuration and fail-closed ambiguity checks.
- [x] Add scrypt password hashing/verification, password-length checks, and tests.
- [x] Add an explicit one-time initial-owner bootstrap command that requires an existing organization and refuses duplicate usernames.
- [x] Add a session-version field to support future server-side session revocation.
- [ ] Execute the organization backfill and initial-owner bootstrap against a backed-up local database.
- [ ] Back up the real database, review dry-run counts, apply the backfill, and verify zero unassigned interviews before making ownership required.
- [ ] Replace shared login with individual employer identity and organization-aware sessions.
- [ ] Enforce organization scoping and role permissions across every employer API.

## Legacy organization backfill procedure

Run this only against a backed-up database after `npm install` and `npm run db:push` have synchronized the additive schema.

After a verified backfill, an initial owner can be provisioned once for the existing organization. This command refuses to overwrite an existing username and prints no password:

```powershell
$env:BOOTSTRAP_EMPLOYER_USERNAME = "owner"
$env:BOOTSTRAP_EMPLOYER_PASSWORD = "use-a-unique-password-of-at-least-12-characters"
$env:BOOTSTRAP_ORGANIZATION_SLUG = "mzobs-legacy"
npm run db:bootstrap-employer-owner
```

Remove the bootstrap password from the environment after use. This creates the identity and owner membership only; the current login route does not authenticate these identities yet.

PowerShell example:

```powershell
$env:LEGACY_ORGANIZATION_NAME = "MZOBS Legacy"
$env:LEGACY_ORGANIZATION_SLUG = "mzobs-legacy"
npm run db:backfill-legacy-organization
```

The default command is read-only and prints the planned organization action and count of interviews with no organization. Review the output and confirm the backup before applying:

```powershell
npm run db:backfill-legacy-organization -- --apply
```

The apply operation runs organization selection/creation, assignment of only rows whose `organizationId` is null, and the final zero-unassigned check in one database transaction. It refuses multiple existing organizations or a mismatched existing slug. The script has not been run on the user's local database; do not claim that any candidate record has been migrated.

## Recommended implementation order

- Phase A: finalize the data model and migration/backfill plan while retaining the current single-employer login.
- Phase B: introduce employer identity, organization, membership, and session identity.
- Phase C: apply tenant scoping to all employer routes and add two-tenant integration tests.
- Phase D: add role-based permissions and actor-attributed audit history.
- Phase E: only after all checks pass, enable organization onboarding and multi-company production use.

## Current release decision

Keep the application in its current single-employer mode. The current authenticated dashboard is suitable for controlled development/testing with one configured employer account, but it is not ready for independent companies to share one deployment. No production multi-tenant claim should be made until the target model and cross-tenant tests are complete.
