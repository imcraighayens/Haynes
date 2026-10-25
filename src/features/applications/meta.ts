import type { ApplicationStatus } from '../../domain/types'
import type { Tone } from '../../ui/bits'

export const APP_STATUS: Record<ApplicationStatus, { label: string; tone: Tone }> = {
  new: { label: 'NEW', tone: 'acc' },
  reviewing: { label: 'REVIEWING', tone: 'amber' },
  approved: { label: 'APPROVED', tone: 'green' },
  declined: { label: 'DECLINED', tone: 'red' },
}
