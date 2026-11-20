type ApprovalTransaction = {
  privacyDeletionRequest: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  privacyDeletionEvent: {
    create(args: unknown): Promise<unknown>;
  };
};

export function approveVerifiedDeletionRequest(
  db: {
    $transaction<T>(callback: (tx: ApprovalTransaction) => Promise<T>): Promise<T>;
  },
  requestId: string
): Promise<boolean>;
