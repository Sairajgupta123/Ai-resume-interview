export type AnswerDepth = "clarify" | "probe" | "deepen";
export type AdaptiveGuidance = { depth: AnswerDepth; instruction: string };
export function assessAnswerDepth(answer: unknown): AnswerDepth;
export function buildAdaptiveGuidance(answer: string): AdaptiveGuidance;
