# SQLite to PostgreSQL migration runbook

## Current state

The application currently uses Prisma with the SQLite provider. The production startup guard intentionally rejects non-`file:` database URLs. This runbook is a preparation and verification plan; it does not switch the provider or claim that PostgreSQL is supported.

The schema currently contains these models:

- `Interview`
- `LoginAttempt`
- `InterviewMessage`
- `EmployerDecisionHistory`
- `InterviewSignal`
- `PrivacyDeletionRequest`
- `PrivacyDeletionEvent`
- `RecordingCleanupTask`

The migration must preserve every primary key, unique constraint, relation, timestamp, nullable field, default and index. In particular, invitation token hashes, one-time exchange state, deletion verification hashes and deletion execution lease tokens must not be regenerated or exposed during migration.

## Application-specific compatibility audit

The current Prisma schema uses string CUID primary keys, nullable and required `String` fields, `Int` counters/scores, `DateTime` timestamps, nullable unique token hashes, relation cascades and ordinary B-tree indexes. Report JSON is stored as text (`String?`), not a Prisma JSON column. Do not silently change these representations during the provider migration.

The application uses Prisma model operations including `count`, `findMany`, `findUnique`, `findFirst`, `create`, `update`, `updateMany`, `upsert`, `deleteMany`, `groupBy` and interactive/array transactions. These are provider-supported Prisma APIs, but their generated SQL, null handling, ordering and transaction behavior still need integration verification on the exact PostgreSQL version.

Specific compatibility checks:

- [ ] Verify `groupBy` on `status`, `employerDecision` (including null) and `role`; confirm grouped counts reconcile to total interview counts.
- [ ] Verify nullable unique values behave as expected for `invitationTokenHash`, `clientMessageId`, `verificationTokenHash` and `executionLeaseToken`; test multiple null rows and duplicate non-null values.
- [ ] Verify every `onDelete: Cascade` relation, especially interview messages, signals, decision history and privacy deletion events.
- [ ] Verify date filters using `lt`, `lte`, `gte` and equality at exact boundaries, including cursor ordering by `createdAt` then string `id`.
- [ ] Verify timestamps retain millisecond precision and UTC instants through export/import; compare records around daylight-saving transitions even though application logic should use absolute instants.
- [ ] Verify increment operations, upserts and conditional `updateMany` claims under concurrent login attempts, transcript retries and deletion-worker lease races.
- [ ] Verify report JSON text round-trips exactly, including Unicode, escaped content, large transcripts and null values.
- [ ] Review any user-facing text filtering and sorting for SQLite-versus-PostgreSQL collation differences; do not assume case-insensitive matching is identical across providers.
- [ ] Run the full deletion database integration suite against PostgreSQL; the current local integration suite uses SQLite and is not evidence of PostgreSQL compatibility.

No provider switch should be inferred from this checklist. It records tests required before the dedicated migration branch can be considered safe.

## Required migration sequence

### 1. Establish a recoverable source snapshot

1. Put interview creation, candidate writes, employer decisions and deletion execution into maintenance mode.
2. Wait for in-flight requests and recording uploads to finish.
3. Create a consistent SQLite backup using SQLite's online backup API or `VACUUM INTO`; do not copy a live database file while it is being written.
4. Record the source database file size, SHA-256 checksum, backup timestamp and per-table row counts.
5. Keep the original database and verified backup read-only until cutover is accepted.

### 2. Create and validate the PostgreSQL schema

1. Change the Prisma datasource provider only in a dedicated migration branch.
2. Generate a reviewed initial migration from the complete Prisma schema; do not use `db push` as the production migration mechanism.
3. Run migrations against a disposable PostgreSQL instance using the same major version and extensions as the intended managed database.
4. Verify all seven models, foreign keys, cascade behavior, unique constraints and indexes.
5. Run Prisma schema validation, unit tests, type checking, production build and database integration tests against PostgreSQL in CI.
6. Verify connection pooling and transaction behavior with the deployment's actual connection limits.

### 3. Copy data without changing identity

Import in foreign-key order:

1. `Interview`
2. `LoginAttempt`
3. `InterviewMessage`, `EmployerDecisionHistory`, `InterviewSignal`, `PrivacyDeletionRequest`
4. `PrivacyDeletionEvent`

Preserve every existing ID and timestamp exactly. Do not re-hash, rotate or otherwise rewrite invitation/deletion tokens as part of a storage-engine migration. Use a migration-only process with no application API exposure, bounded batches, explicit transaction boundaries and resumable checkpoints. Keep candidate text, transcripts and deletion metadata out of logs.

After import, compare source and destination row counts for every table, compare primary-key sets, check all foreign keys, verify unique constraints and compare representative records including nulls, Unicode, long text and timestamp precision. Reset PostgreSQL sequences only if the generated schema uses sequences; current Prisma string IDs should not need them.

### 4. Verify application behavior before cutover

Run integration tests for:

- Employer login, rate limiting and session verification
- Invitation creation, expiry, one-time exchange and candidate refresh recovery
- Transcript idempotency and interview time limits
- Report persistence and employer decision history
- WebRTC signalling cursor ordering and cleanup
- Recording metadata and storage deletion
- Candidate verification, employer approval, deletion execution leases, retry behavior and cascade deletion
- Concurrent interview updates and simultaneous deletion attempts

Also perform a staging smoke test using the production build, private object storage and the intended managed PostgreSQL service.

### 5. Cut over and retain rollback capability

1. Keep the application in maintenance mode while the final SQLite snapshot is imported.
2. Run the full verification checklist again against the final import.
3. Update the production `DATABASE_URL` and deploy the PostgreSQL-enabled application together.
4. Keep the source SQLite database and snapshot read-only for the agreed rollback window.
5. Do not simply point the application back to SQLite after PostgreSQL has accepted writes; that would lose post-cutover data. A rollback after writes requires a tested reverse data transfer or a restore plan that explicitly accepts the loss window.
6. Resume candidate traffic only after database, auth, invitation, transcript, deletion and recording smoke tests pass.

## Release gates

The migration is not complete until all of these are true:

- [ ] A consistent, restorable SQLite backup exists.
- [ ] A reviewed Prisma migration exists in version control.
- [ ] CI runs integration tests against PostgreSQL, not only SQLite.
- [ ] All seven models and all constraints/indexes are verified on PostgreSQL.
- [ ] Source and destination row counts and primary-key sets match.
- [ ] Transcript, invitation, decision and privacy-deletion workflows pass on PostgreSQL.
- [ ] Production connection pooling, backups and restore are tested.
- [ ] Private S3-compatible recording upload, playback and deletion are tested against the intended provider.
- [ ] A rollback plan accounts for writes accepted after cutover.

Until every gate is checked, keep the SQLite provider and production URL guard unchanged. Do not direct a production deployment to PostgreSQL prematurely.
