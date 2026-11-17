export function isApiErrorText(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = JSON.parse(value);
    return parsed !== null
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && parsed.error !== undefined
      && parsed.error !== null;
  } catch {
    return false;
  }
}
