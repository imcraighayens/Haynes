import type { Role } from './types'

export type Area =
  | 'dashboard' | 'loans' | 'applications' | 'clients' | 'logbook' | 'ledger' | 'petty' | 'notifications'

export type Action =
  | 'loan.create' | 'loan.edit' | 'loan.status' | 'loan.delete' | 'loan.writeoff'
  | 'client.create' | 'client.edit' | 'client.delete' | 'client.revealPii'
  | 'application.decide' | 'petty.create' | 'bank.manage' | 'employees.manage' | 'settings.manage' | 'data.import'

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
  agent: 'Loan officer',
  collections: 'Collections',
  auditor: 'Auditor',
}

const ALL_AREAS: Area[] = ['dashboard', 'loans', 'applications', 'clients', 'logbook', 'ledger', 'petty', 'notifications']

const AREAS: Record<Role, Area[]> = {
  admin: ALL_AREAS,
  manager: ALL_AREAS,
  auditor: ALL_AREAS,
  agent: ['dashboard', 'loans', 'applications', 'clients', 'petty', 'notifications'],
  collections: ['dashboard', 'loans', 'clients', 'notifications', 'logbook'],
}

const ACTIONS: Record<Role, Action[]> = {
  admin: [
    'loan.create', 'loan.edit', 'loan.status', 'loan.delete', 'loan.writeoff', 'client.create', 'client.edit',
    'client.delete', 'client.revealPii', 'application.decide', 'petty.create', 'bank.manage', 'employees.manage',
    'settings.manage', 'data.import',
  ],
  manager: [
    'loan.create', 'loan.edit', 'loan.status', 'loan.writeoff', 'client.create', 'client.edit', 'client.revealPii',
    'application.decide', 'petty.create', 'bank.manage',
  ],
  agent: ['loan.create', 'loan.status', 'client.create', 'client.edit', 'petty.create'],
  collections: ['loan.status'],
  auditor: ['client.revealPii'],
}

export const canSee = (role: Role, area: Area) => AREAS[role].includes(area)
export const can = (role: Role, action: Action) => ACTIONS[role].includes(action)

/** Permission grid for the Employees & roles pane. */
export const PERMISSION_GRID = (Object.keys(ACTIONS) as Role[]).map((r) => ({ role: r, areas: AREAS[r], actions: ACTIONS[r] }))

export const ACTION_LABEL: Record<Action, string> = {
  'loan.create': 'Issue loans',
  'loan.edit': 'Edit loans',
  'loan.status': 'Update loan status',
  'loan.delete': 'Archive loans',
  'loan.writeoff': 'Write off loans',
  'client.create': 'Add clients',
  'client.edit': 'Edit clients',
  'client.delete': 'Archive clients',
  'client.revealPii': 'Reveal ID & bank details',
  'application.decide': 'Approve / decline applications',
  'petty.create': 'Log petty cash',
  'bank.manage': 'Manage bank & expenses',
  'employees.manage': 'Manage employees',
  'settings.manage': 'Change settings',
  'data.import': 'Import / reset data',
}
