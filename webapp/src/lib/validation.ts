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
