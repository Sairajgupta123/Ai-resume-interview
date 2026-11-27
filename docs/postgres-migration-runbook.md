# SQLite to PostgreSQL migration runbook

## Current state

The migration branch uses Prisma with the PostgreSQL provider and contains a separate SQLite Prisma schema solely for reading a frozen source snapshot. The importer is one-way and verifies every copied record. This branch is still a draft: production cutover is not authorized until PostgreSQL CI, a real SQLite snapshot import, staging workflow tests and managed-database restore rehearsal pass.

The schema currently contains these models:

- `Interview`
- `LoginAttempt`
- `InterviewMessage`
- `EmployerDecisionHistory`
- `InterviewSignal`
- `PrivacyDeletionRequest`
- `PrivacyDeletionEvent`

The migration must preserve every primary key, unique constraint, relation, timestamp, nullable field, default and index. In particular, invitation token hashes, one-time exchange state, deletion verification hashes and deletion execution lease tokens must not be regenerated or exposed during migration.

## Required migration sequence

### 1. Establish a recoverable source snapshot

1. Put interview creation, candidate writes, employer decisions and deletion execution into maintenance mode.
2. Wait for in-flight requests and recording uploads to finish.
3. Create a consistent SQLite backup using SQLite's online backup API or `VACUUM INTO`; do not copy a live database file while it is being written.
4. Record the source database file size, SHA-256 checksum, backup timestamp and per-table row counts.
5. Keep the original database and verified backup read-only until cutover is accepted.

### 2. Create and validate the PostgreSQL schema

1. The dedicated branch changes the Prisma provider and keeps `prisma/schema.sqlite.prisma` as a source-only client schema.
2. The initial migration is committed under `prisma/migrations`; do not use `db push` as the production migration mechanism.
3. CI runs PostgreSQL 16, validates both Prisma schemas and applies the committed migration before tests and build.
4. Verify all seven models, foreign keys, cascade behavior, unique constraints and indexes.
5. Run database integration tests and a production build against PostgreSQL in CI.
6. Verify connection pooling and transaction behavior with the deployment's actual connection limits.

### 3. Copy data without changing identity

Import in foreign-key order:

1. `Interview`
2. `LoginAttempt`
3. `InterviewMessage`, `EmployerDecisionHistory`, `InterviewSignal`, `PrivacyDeletionRequest`
4. `PrivacyDeletionEvent`

Preserve every existing ID and timestamp exactly. Do not re-hash, rotate or otherwise rewrite invitation/deletion tokens as part of a storage-engine migration. The repository importer is `npm run db:import-sqlite`; set `SQLITE_DATABASE_URL` to a frozen SQLite backup and `DATABASE_URL` to the PostgreSQL destination. Generate both Prisma clients with `npm run db:generate`. It copies in bounded batches of 500, computes a SHA-256 fingerprint over every source row without logging candidate data, and stores that fingerprint in a private PostgreSQL import-state table. `--resume` is accepted only when the frozen SQLite snapshot fingerprint exactly matches the interrupted import; an altered or replaced source is rejected. Every copied record is compared for exact value equality and table row counts are verified. Example PowerShell: `$env:SQLITE_DATABASE_URL='file:C:/backups/mzobs-frozen.db'; $env:DATABASE_URL='postgresql://...'; npm run db:import-sqlite`. Keep candidate text, transcripts and deletion metadata out of logs. Never use `--resume` with a different source snapshot.

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
5. Treat application rollback and database rollback separately. If a release bug appears after PostgreSQL has accepted writes, roll back the application artifact while keeping PostgreSQL as the database.
6. If PostgreSQL data is damaged, restore the managed PostgreSQL service using its tested point-in-time recovery or backup procedure; do not change `DATABASE_URL` to the old SQLite snapshot.
7. Do not simply point the application back to SQLite after PostgreSQL has accepted writes; that would lose post-cutover data. This repository does not currently ship a PostgreSQL-to-SQLite reverse importer. If returning writes to SQLite is a hard requirement, keep maintenance mode active and build/rehearse that reverse transfer before cutover.
8. Resume candidate traffic only after database, auth, invitation, transcript, deletion and recording smoke tests pass.

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
- [ ] A rollback drill proves application rollback keeps PostgreSQL as the source of truth.
- [ ] Managed PostgreSQL point-in-time restore or backup recovery is rehearsed.
- [ ] If SQLite rollback is required, a reverse importer is implemented and tested before cutover.

Until every gate is checked, do not merge this draft branch or point production traffic at PostgreSQL.
