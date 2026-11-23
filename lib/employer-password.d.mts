export function hashEmployerPassword(password: string): Promise<string>;
export function verifyEmployerPassword(password: string, encoded: string): Promise<boolean>;
