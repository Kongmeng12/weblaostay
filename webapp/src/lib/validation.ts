// Client-side hints only — the backend (auth.dto.ts's PHONE_PATTERN, @IsEmail())
// is the real gate. Kept in sync in intent with lib/core/validation/identifier_validator.dart.

export function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

export function looksLikePhone(value: string): boolean {
  return /^\+?[0-9][0-9\s-]{5,19}$/.test(value.trim());
}

export function isValidIdentifier(value: string): boolean {
  return looksLikeEmail(value) || looksLikePhone(value);
}

/**
 * The rule for a new password, same as the backend's NEW_PASSWORD_PATTERN:
 * a letter (any script) and a digit, on top of `minLength={8}`. As an input
 * `pattern`, so the browser stops the form and shows the `title` before the
 * request is sent.
 */
export const NEW_PASSWORD_PATTERN = '(?=.*\\p{L})(?=.*\\p{Nd}).+';
export const NEW_PASSWORD_HINT = 'ຢ່າງໜ້ອຍ 8 ຕົວ · ມີທັງຕົວອັກສອນ ແລະ ຕົວເລກ';
