/**
 * Turns whatever a user typed into the one stored form: E.164 (`+` and the
 * country code, digits only — `+201012345678`). One canonical string per real
 * number is what makes the one-account-per-phone rule (idx_users_phone) hold
 * no matter how the number was spelled. Returns null when it isn't a phone
 * number we can accept.
 *
 * Accepted:
 *  - international, with `+` or the `00` prefix, any country: `+9665xxxxxxxx`,
 *    `00 44 7911 123456`, `+1 (415) 555-0132`
 *  - Egyptian national mobile format, kept for existing users and the default
 *    audience: `01[0125]xxxxxxxx` → `+201[0125]xxxxxxxx`
 *
 * Without a country code we can't tell where a number is from, so anything
 * else is refused rather than guessed at. Egyptian numbers get the stricter
 * mobile-only check (+20 1[0125]…) since that is the one format we know
 * exactly; every other country is only checked for E.164 length (7–15
 * digits). That catches typos, not fake numbers — there is no SMS
 * verification behind this.
 */
export function normalizePhone(input) {
  let value = String(input ?? '').trim().replace(/[\s().-]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;

  if (/^01[0125]\d{8}$/.test(value)) return `+2${value}`;
  if (!/^\+[1-9]\d{6,14}$/.test(value)) return null;
  if (value.startsWith('+20') && !/^\+201[0125]\d{8}$/.test(value)) return null;
  return value;
}

export const INVALID_PHONE_MESSAGE =
  'اكتب رقم موبايل صحيح بكود الدولة (مثال: +966512345678) — أو 01xxxxxxxxx للأرقام المصرية';
