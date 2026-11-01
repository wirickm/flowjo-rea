// Expected failures carry a stable code so the UI and tests can distinguish them
// from programming errors.
export type ErrorCode =
  | 'FCS_TRUNCATED'
  | 'FCS_BAD_HEADER'
  | 'FCS_BAD_TEXT'
  | 'FCS_MISSING_KEYWORD'
  | 'FCS_UNSUPPORTED'
  | 'FCS_BAD_OFFSETS'
  | 'COMP_INVALID'
  | 'COMP_SINGULAR'
  | 'COMP_CHANNEL_MISMATCH'
  | 'TRANSFORM_INVALID'
  | 'GATE_INVALID'
  | 'CHANNEL_MISSING'
  | 'WORKSPACE_INVALID'
  | 'XML_INVALID'
  | 'UNSUPPORTED_FEATURE'
  | 'FIT_INVALID';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function fail(code: ErrorCode, message: string): never {
  throw new AppError(code, message);
}
