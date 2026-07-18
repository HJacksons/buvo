import type { AppData, User } from '../src/domain/types'

export type StoreInfo = {
  engine: 'sqlite' | 'postgres'
  location: string
  productCount: { count: number }
  revision: number
  schemaVersion: number
}

export type ReplaceStoreOptions = {
  expectedRevision?: number | null
}

export type ReplaceStoreResult = {
  revision: number
}

export type DataStore = {
  authenticateUser(staffNumber: string, pin: string): Promise<User | null>
  getDatabaseInfo(): Promise<StoreInfo>
  loadStore(): Promise<AppData>
  replaceStore(data: AppData, options?: ReplaceStoreOptions): Promise<ReplaceStoreResult>
  resetStore(): Promise<AppData>
  unlockUser(userId: string, pin: string): Promise<User | null>
}

export const createDataStore = async (): Promise<DataStore> => {
  if (process.env.BUVO_DATABASE === 'postgres') {
    const { createPostgresStore } = await import('./postgres-store')

    return createPostgresStore()
  }

  const sqlite = await import('./database')

  return {
    authenticateUser: async (staffNumber, pin) => sqlite.authenticateUser(staffNumber, pin),
    getDatabaseInfo: async () => sqlite.getDatabaseInfo() as StoreInfo,
    loadStore: async () => sqlite.loadStore(),
    replaceStore: async (data) => ({ revision: sqlite.replaceStore(data) }),
    resetStore: async () => sqlite.resetStore(),
    unlockUser: async (userId, pin) => sqlite.unlockUser(userId, pin),
  }
}
