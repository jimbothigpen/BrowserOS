import { getBrowserOSRoleTemplate } from '@browseros/shared/constants/role-aware-agents'
import type {
  BrowserOSAgentRoleId,
  BrowserOSAgentRoleSummary,
  BrowserOSCustomRoleInput,
  BrowserOSRoleTemplate,
} from '@browseros/shared/types/role-aware-agents'

export function resolveRoleTemplate(
  roleId: BrowserOSAgentRoleId,
): BrowserOSRoleTemplate {
  const role = getBrowserOSRoleTemplate(roleId)
  if (!role) {
    throw new Error(`Unknown BrowserOS role: ${roleId}`)
  }
  return role
}

export function toRoleSummary(
  role: BrowserOSRoleTemplate | BrowserOSCustomRoleInput,
): BrowserOSAgentRoleSummary {
  return {
    roleSource: 'id' in role ? 'builtin' : 'custom',
    roleId: 'id' in role ? role.id : undefined,
    roleName: role.name,
    shortDescription: role.shortDescription,
  }
}
