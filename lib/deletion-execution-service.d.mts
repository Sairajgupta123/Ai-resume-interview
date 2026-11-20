type ExecutionTransaction = {
  privacyDeletionRequest: {
    updateMany(args: unknown): Promise<{ count: number }>;
    update(args: unknown): Promise<unknown>;
  };
  interviewMessage: { deleteMany(args: unknown): Promise<unknown> };
  interviewSignal: { deleteMany(args: unknown): Promise<unknown> };
  employerDecisionHistory: { deleteMany(args: unknown): Promise<unknown> };
  interview: { deleteMany(args: unknown): Promise<unknown> };
  privacyDeletionEvent: { create(args: unknown): Promise<unknown> };
};

type Database = {
  $transaction<T>(callback: (tx: ExecutionTransaction) => Promise<T>): Promise<T>;
};

export function finalizeDeletionExecution(
  db: Database,
  input: { requestId: string; interviewId: string; leaseToken: string; now?: Date }
): Promise<void>;

export function markDeletionExecutionFailed(
  db: Database,
  input: { requestId: string; leaseToken: string; errorCode: string }
): Promise<boolean>;
