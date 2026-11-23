export type BoundedJsonResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400 | 413; error: string };

export function readBoundedJson(
  request: Request,
  maxBytes: number
): Promise<BoundedJsonResult>;
