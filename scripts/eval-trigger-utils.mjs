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

export function checkActualModels(models, required) {
  if (!required) return { ok: true, missing: 0, mismatched: [] };
  const observed = models.filter((model) => typeof model === 'string' && model);
  const missing = models.length - observed.length;
  const mismatched = [...new Set(observed.filter((model) => !model.includes(required)))];
  return {
    ok: models.length > 0 && missing === 0 && mismatched.length === 0,
    missing,
    mismatched,
  };
}

export function classifyTriggerTool(toolName, input, skills) {
  if (toolName === 'Skill') {
    const match = input.match(/"(?:skill|command|name)"\s*:\s*"([^"]+)"/);
    const selected = match ? match[1].replace(/^\//, '').split(/\s/)[0] : '';
    return skills.includes(selected) ? selected : `other:${selected}`;
  }
  if (toolName === 'Read') {
    const match = input.match(/skills[\\/]+([^\\/"]+)[\\/]+SKILL\.md/);
    if (match) return skills.includes(match[1]) ? match[1] : `other:${match[1]}`;
  }
  return 'none';
}
