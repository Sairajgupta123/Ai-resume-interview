export function isCandidateInvitationActive(token: unknown, expiresAt: Date | null | undefined, status: string | null | undefined, nowMs?: number): boolean;
export function canExchangeCandidateInvitation(status: string, startedAt: Date | null, expiresAt: Date | null, nowMs?: number): boolean;
