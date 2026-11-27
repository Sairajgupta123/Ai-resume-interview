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
