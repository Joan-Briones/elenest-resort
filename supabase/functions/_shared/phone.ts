const PH_PHONE_RE = /^09[0-9]{9}$/;

export function normalizePhilippinePhone(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("09")) {
    return digits;
  }
  if (digits.length === 12 && digits.startsWith("639")) {
    return "0" + digits.slice(2);
  }
  if (digits.length === 10 && digits.startsWith("9")) {
    return "0" + digits;
  }
  return null;
}

export function isValidPhilippinePhone(phone: string): boolean {
  return PH_PHONE_RE.test(phone);
}
