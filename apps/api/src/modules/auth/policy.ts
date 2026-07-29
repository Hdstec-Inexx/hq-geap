import type { UserRole } from '@hq-geap/contracts/auth';

const readMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function canUseMethod(role: UserRole, method: string) {
  return role !== 'gestao' || readMethods.has(method);
}

export function canAccessRoles(role: UserRole, allowedRoles?: UserRole[]) {
  return role === 'admin' || !allowedRoles || allowedRoles.includes(role);
}

function withoutCost(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutCost);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'custo')
        .map(([key, nestedValue]) => [key, withoutCost(nestedValue)])
    );
  }
  return value;
}

export function redactCostFromJson(payload: string) {
  try {
    return JSON.stringify(withoutCost(JSON.parse(payload)));
  } catch {
    return payload;
  }
}
