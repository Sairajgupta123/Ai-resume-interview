# Applying Prisma schema updates to an existing SQLite deployment

The application currently uses Prisma with SQLite and does not yet maintain a checked-in Prisma Migrate history. The employer dashboard indexes are declared in `prisma/schema.prisma`; an existing persistent SQLite database will not gain those indexes merely because the application bundle was rebuilt. The interview list's `(createdAt, id)` index supports its stable newest-first cursor ordering. `InterviewMessage.isTerminal` records whether a persisted interviewer turn ended the interview, so retries can restore the original completion signal.

## Safe staging procedure

1. Confirm the deployment is using a persistent SQLite file and identify its exact `DATABASE_URL` path.
2. Put the application into maintenance mode so no interview, transcript, decision or deletion writes are in flight.
3. Create a consistent SQLite backup using SQLite's online backup API or `VACUUM INTO`. Do not copy a live database file while it is being written.
4. Run schema validation against the release checkout:

   ```sh
   npx prisma validate
   ```

5. Apply the reviewed additive schema changes against the same database URL:

   ```sh
   npx prisma db push
   ```

6. Restart the application and run the employer login, interview listing, pagination, candidate detail and decision audit smoke tests.
7. Confirm the database remains readable, interview counts match the pre-change snapshot, and the backup can be restored in a non-production test.

## Guardrails

- Do not change the datasource provider to PostgreSQL as part of this procedure.
- Do not use an ephemeral serverless filesystem for SQLite.
- Do not run `db push` against production without a verified backup, maintenance window and staging rehearsal.
- Do not use `--accept-data-loss` to force a schema change.
- PostgreSQL requires a separate reviewed Prisma migration and data-transfer process described in [the PostgreSQL migration runbook](postgres-migration-runbook.md).

## Recording cleanup queue schema addition

The current branch adds the `RecordingCleanupTask` table as an additive change. It records the stored object path, bounded reason/error codes, retry time, attempt count and worker lease. It intentionally has no foreign key to `Interview` because a task must survive deletion of the interview row. The unique object path makes enqueue idempotent.

Apply this addition using the safe staging procedure above. The application must not be deployed with the new worker route until `npx prisma db push` has created the table on the persistent SQLite database. The worker requires `CRON_SECRET` and should be invoked only by a trusted scheduler. Verify the worker can claim a pending task, skip a still-referenced object, delete an unreferenced test object, retry a transient failure and reclaim an expired lease before enabling it for production traffic.

## Recording cleanup worker operations and alerts

The cleanup endpoint is designed to be called at least once per minute by a trusted scheduler. The worker is safe against overlapping invocations: each task is claimed with a conditional database update and a unique lease token. Each invocation handles at most 10 tasks; a busy queue is drained over subsequent runs.

Monitor the scheduler independently from the application:

- Alert when two consecutive scheduled invocations fail, time out or receive a non-2xx response.
- Alert when a task reaches 12 attempts. The worker intentionally stops retrying at that ceiling; an operator must inspect the bounded `lastErrorCode`, storage health and object reference before deciding how to recover it.
- Alert when an `in_progress` lease is older than 5 minutes. A two-minute lease can be reclaimed automatically; the longer alert threshold allows for scheduler delay and clock jitter.
- Alert when due `pending` or `failed` tasks remain due for more than 15 minutes, which can indicate scheduler downtime or a sustained backlog.

Read-only SQLite checks (run against a consistent database snapshot or through a read-only connection):

```sql
-- Counts by state and bounded failure code
SELECT status, lastErrorCode, COUNT(*) AS task_count
FROM RecordingCleanupTask
GROUP BY status, lastErrorCode
ORDER BY status, lastErrorCode;

-- Tasks that have exhausted automatic retries
SELECT id, reason, status, attempts, lastErrorCode, updatedAt
FROM RecordingCleanupTask
WHERE attempts >= 12 AND status != 'completed'
ORDER BY updatedAt ASC;

-- Leases that may need investigation (the worker can reclaim after 2 minutes)
SELECT id, reason, attempts, leaseStartedAt, lastErrorCode
FROM RecordingCleanupTask
WHERE status = 'in_progress'
  AND julianday(leaseStartedAt) < julianday('now', '-5 minutes');

-- Due tasks that have remained unprocessed for 15 minutes
SELECT status, COUNT(*) AS overdue_count
FROM RecordingCleanupTask
WHERE status IN ('pending', 'failed')
  AND julianday(nextAttemptAt) < julianday('now', '-15 minutes')
GROUP BY status;
```

Do not print or export stored object paths into general application logs. The worker's error code is deliberately bounded and does not include provider response bodies or credentials. Before manually retrying a task at the attempt ceiling, confirm that its object is not referenced by any interview and that the configured storage endpoint/bucket is healthy. Prefer a controlled operator action that preserves the reference check and audit trail; do not directly delete an object or reset counters with ad-hoc SQL.

Rotate `CRON_SECRET` by updating the deployment secret and scheduler secret together, then verify an old credential is rejected and the new credential succeeds. Never put the secret in a URL, query parameter, client bundle or scheduler log.
