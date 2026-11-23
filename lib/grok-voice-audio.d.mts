export function resampleFloat32ToPcm16(
  samples: Float32Array,
  inputRate: number,
  outputRate?: number
): Int16Array;

export function pcm16ToBase64(samples: Int16Array): string;

export function base64Pcm16ToFloat32(base64: string): Float32Array;
