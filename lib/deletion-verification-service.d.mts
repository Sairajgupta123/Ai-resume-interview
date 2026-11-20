type VerificationTransaction = {
  privacyDeletionRequest: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  privacyDeletionEvent: {
    create(args: unknown): Promise<unknown>;
  };
};

export function verifyDeletionRequest(
  db: {
    $transaction<T>(callback: (tx: VerificationTransaction) => Promise<T>): Promise<T>;
  },
  requestId: string,
  tokenHash: string,
  now?: Date
): Promise<boolean>;
