type VerificationTransaction = {
  privacyDeletionRequest: {
    updateMany(args: unknown): Promise<{ count: number }>;
    findFirst(args: unknown): Promise<{ id: string } | null>;
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

export function reserveDeletionVerificationEmail(
  db: {
    privacyDeletionRequest: {
      updateMany(args: unknown): Promise<{ count: number }>;
    };
  },
  input: {
    requestId: string;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
    cooldownMs: number;
  }
): Promise<boolean>;

export function recordDeletionVerificationEmailSent(
  db: {
    $transaction<T>(callback: (tx: VerificationTransaction) => Promise<T>): Promise<T>;
  },
  requestId: string,
  tokenHash: string
): Promise<boolean>;
