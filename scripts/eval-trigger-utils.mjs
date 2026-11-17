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
