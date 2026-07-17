import type { AppData } from '../domain/types'
import { initialData } from './seed'

const STORAGE_KEY = 'buvo-pos-store-v3'
const LEGACY_STORAGE_KEY = 'buvo-pos-store-v2'
const STORAGE_VERSION = 3
const API_BASE_URL = import.meta.env.VITE_BUVO_API_URL ?? 'http://127.0.0.1:8787'

type StoredPayload = {
  app: 'buvo-pos'
  version: number
  savedAt: string
  data: AppData
}

type LoadResult = {
  data: AppData
  message: string
  savedAt: string | null
  source: 'demo' | 'local' | 'legacy'
}

type SaveResult = {
  ok: boolean
  message: string
  savedAt: string | null
  storage: 'browser' | 'sqlite' | 'unavailable'
}

const appDataKeys: Array<keyof AppData> = [
  'products',
  'movements',
  'sales',
  'returns',
  'shifts',
  'debtors',
  'debtTransactions',
  'users',
  'auditLogs',
  'efrisTransactions',
  'categories',
  'suppliers',
]

const getFallbackStaffNumber = (userId: string, index: number) => {
  const knownNumbers: Record<string, string> = {
    'usr-owner': '0001',
    'usr-cashier-1': '1001',
    'usr-stock': '2001',
    'usr-manager': '3001',
  }

  return knownNumbers[userId] ?? `9${String(index + 1).padStart(3, '0')}`
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isAppData = (value: unknown): value is AppData =>
  isObject(value) && appDataKeys.every((key) => Array.isArray(value[key]))

export const normalizeAppData = (storedData: AppData): AppData => {
  const shouldSeedDebtors =
    !storedData.debtors?.length && !storedData.debtTransactions?.length
  const storedDebtors = shouldSeedDebtors ? initialData.debtors : (storedData.debtors ?? [])
  const storedDebtTransactions = shouldSeedDebtors
    ? initialData.debtTransactions
    : (storedData.debtTransactions ?? [])
  const missingDemoDebtTransactions = initialData.debtTransactions.filter(
    (transaction) =>
      storedDebtors.some((debtor) => debtor.id === transaction.debtorId) &&
      !storedDebtTransactions.some((stored) => stored.id === transaction.id),
  )

  return {
    ...storedData,
    debtors: storedDebtors,
    debtTransactions: [...missingDemoDebtTransactions, ...storedDebtTransactions],
    users: storedData.users.map((user, index) => ({
      ...user,
      staffNumber: user.staffNumber ?? getFallbackStaffNumber(user.id, index),
    })),
  }
}

const parseStoredPayload = (rawValue: string): { data: AppData; savedAt: string | null } => {
  const parsed = JSON.parse(rawValue) as unknown

  if (isObject(parsed) && parsed.app === 'buvo-pos' && isAppData(parsed.data)) {
    return {
      data: normalizeAppData(parsed.data),
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null,
    }
  }

  if (isAppData(parsed)) {
    return {
      data: normalizeAppData(parsed),
      savedAt: null,
    }
  }

  throw new Error('Invalid BUVO POS storage payload.')
}

export const createBackupPayload = (data: AppData): StoredPayload => ({
  app: 'buvo-pos',
  version: STORAGE_VERSION,
  savedAt: new Date().toISOString(),
  data,
})

export const parseBackupPayload = (rawValue: string): AppData =>
  parseStoredPayload(rawValue).data

export const loadPersistedData = (): LoadResult => {
  if (typeof window === 'undefined') {
    return {
      data: initialData,
      message: 'Demo data loaded.',
      savedAt: null,
      source: 'demo',
    }
  }

  const saved = window.localStorage.getItem(STORAGE_KEY)
  const legacySaved = window.localStorage.getItem(LEGACY_STORAGE_KEY)
  const rawValue = saved ?? legacySaved

  if (!rawValue) {
    return {
      data: initialData,
      message: 'Demo data loaded. Changes will save on this device.',
      savedAt: null,
      source: 'demo',
    }
  }

  try {
    const parsed = parseStoredPayload(rawValue)

    return {
      data: parsed.data,
      message: saved
        ? 'Local saved data loaded.'
        : 'Older local data loaded and will be upgraded on save.',
      savedAt: parsed.savedAt,
      source: saved ? 'local' : 'legacy',
    }
  } catch {
    return {
      data: initialData,
      message: 'Saved data could not be read. Demo data loaded instead.',
      savedAt: null,
      source: 'demo',
    }
  }
}

const fetchWithTimeout = async (url: string, options?: RequestInit) => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 1200)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timeout)
  }
}

export const loadDatabaseData = async (): Promise<LoadResult | null> => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/store`)

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as {
      data?: unknown
      savedAt?: string
      storage?: string
    }

    if (!isAppData(payload.data)) {
      return null
    }

    return {
      data: normalizeAppData(payload.data),
      message: 'SQLite database connected.',
      savedAt: payload.savedAt ?? null,
      source: 'local',
    }
  } catch {
    return null
  }
}

export const savePersistedData = (data: AppData): SaveResult => {
  if (typeof window === 'undefined') {
    return {
      ok: false,
      message: 'Storage is not available in this environment.',
      savedAt: null,
      storage: 'unavailable',
    }
  }

  const payload = createBackupPayload(data)

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    return {
      ok: true,
      message: 'Saved locally on this device.',
      savedAt: payload.savedAt,
      storage: 'browser',
    }
  } catch {
    return {
      ok: false,
      message: 'Could not save locally. Download a backup before closing.',
      savedAt: null,
      storage: 'unavailable',
    }
  }
}

export const saveDatabaseData = async (data: AppData): Promise<SaveResult> => {
  if (typeof window === 'undefined') {
    return {
      ok: false,
      message: 'SQLite API is not available in this environment.',
      savedAt: null,
      storage: 'unavailable',
    }
  }

  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/store`, {
      body: JSON.stringify({ data }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    })

    if (!response.ok) {
      throw new Error('SQLite save failed.')
    }

    const payload = (await response.json()) as { savedAt?: string }

    return {
      ok: true,
      message: 'Saved to SQLite database.',
      savedAt: payload.savedAt ?? new Date().toISOString(),
      storage: 'sqlite',
    }
  } catch {
    const fallback = savePersistedData(data)

    return {
      ok: fallback.ok,
      message: fallback.ok
        ? 'SQLite unavailable. Saved in browser fallback.'
        : 'SQLite unavailable and browser fallback failed. Download a backup.',
      savedAt: fallback.savedAt,
      storage: fallback.ok ? 'browser' : 'unavailable',
    }
  }
}
