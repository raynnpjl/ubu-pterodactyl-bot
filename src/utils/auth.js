const allowedRoleIds = (process.env.ALLOWED_ROLE_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

export function getAllowedRoleIds() {
  return allowedRoleIds;
}

export function hasAllowedRole(interaction) {
  if (allowedRoleIds.length === 0) return false;
  const roles = interaction.member?.roles;
  if (!roles) return false;
  if (typeof roles.cache?.some === 'function') {
    return roles.cache.some((r) => allowedRoleIds.includes(r.id));
  }
  if (Array.isArray(roles)) {
    return roles.some((id) => allowedRoleIds.includes(id));
  }
  return false;
}
