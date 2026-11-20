export const DELETION_VERIFICATION_TTL_MS: number;
export const DELETION_VERIFICATION_RESEND_COOLDOWN_MS: number;
export const MAX_DELETION_VERIFICATION_ATTEMPTS: number;
export function createDeletionVerificationToken(): string;
export function hashDeletionVerificationToken(token: string): string;
export function verifyDeletionVerificationToken(token: unknown, storedHash: unknown): boolean;
export function canVerifyDeletionRequest(request: { status: string; verificationExpiresAt: Date | string | null; verificationAttempts: number } | null, now?: Date): boolean;
export function canSendDeletionVerification(request: { status: string; verificationSentAt: Date | string | null } | null, now?: Date): boolean;
