const KEY = 'evolt.settings.v1'

export interface AppSettings {
  defaultInterestRate: number
  businessName: string
}

export const defaultSettings: AppSettings = {
  defaultInterestRate: 35,
  businessName: 'e.Volt',
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...defaultSettings, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    /* ignore */
  }
  return defaultSettings
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(KEY, JSON.stringify(s))
}
