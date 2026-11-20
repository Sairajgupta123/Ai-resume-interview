export function rotateCandidateInvitationToken(
  db: {
    interview: {
      updateMany(args: {
        where: {
          id: string;
          invitationTokenHash: string;
          status: "invited";
          startedAt: null;
          inviteUsedAt: null;
          inviteExpiresAt: { gt: Date };
        };
        data: { invitationTokenHash: string; inviteUsedAt: Date };
      }): Promise<{ count: number }>;
    };
  },
  input: { sessionId: string; currentTokenHash: string; sessionTokenHash: string; now?: Date }
): Promise<boolean>;
