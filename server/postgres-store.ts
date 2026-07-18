import pg from 'pg'
import { initialData } from '../src/data/seed'
import type { AppData, User } from '../src/domain/types'
import { hashPin, verifyPinHash } from './pin-security'
import type { DataStore, ReplaceStoreOptions, ReplaceStoreResult, StoreInfo } from './store'

const { Pool } = pg

const SCHEMA_VERSION = 3
const STORE_ID = 'main'

type CredentialRow = {
  active: boolean
  id: string
  name: string
  pin_hash: string | null
  role: User['role']
  staff_number: string
}

const databaseUrl = process.env.DATABASE_URL ?? process.env.BUVO_POSTGRES_URL

const createPool = () => {
  if (!databaseUrl) {
    throw new Error(
      'BUVO_DATABASE=postgres requires DATABASE_URL or BUVO_POSTGRES_URL.',
    )
  }

  return new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.BUVO_POSTGRES_POOL_SIZE ?? 10),
  })
}

const sanitizeUsers = (data: AppData): AppData => ({
  ...data,
  users: data.users.map((user) => ({ ...user, pin: '' })),
})

const ensureSchema = async (pool: pg.Pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_snapshots (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      revision BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_credentials (
      id TEXT PRIMARY KEY,
      staff_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL
    );
  `)
  await pool.query(
    `
      INSERT INTO schema_migrations (version, applied_at)
      VALUES ($1, NOW())
      ON CONFLICT (version) DO NOTHING
    `,
    [SCHEMA_VERSION],
  )
}

const seedIfEmpty = async (pool: pg.Pool) => {
  const snapshot = await pool.query<{ id: string }>(
    'SELECT id FROM store_snapshots WHERE id = $1',
    [STORE_ID],
  )

  if (snapshot.rowCount === 0) {
    await replaceStoreWithClient(pool, initialData)
  }
}

const getRevision = async (pool: pg.Pool) => {
  const result = await pool.query<{ revision: string }>(
    'SELECT revision FROM store_snapshots WHERE id = $1',
    [STORE_ID],
  )

  return Number(result.rows[0]?.revision ?? 0)
}

const upsertCredentials = async (client: pg.Pool | pg.PoolClient, data: AppData) => {
  const existing = await client.query<{ id: string; pin_hash: string }>(
    'SELECT id, pin_hash FROM user_credentials',
  )
  const existingHashes = new Map(existing.rows.map((row) => [row.id, row.pin_hash]))

  for (const user of data.users) {
    const pinHash = user.pin ? hashPin(user.pin) : existingHashes.get(user.id)

    if (!pinHash) {
      throw new Error(`Missing PIN for ${user.name}.`)
    }

    await client.query(
      `
        INSERT INTO user_credentials (id, staff_number, name, role, pin_hash, active)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          staff_number = EXCLUDED.staff_number,
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          pin_hash = EXCLUDED.pin_hash,
          active = EXCLUDED.active
      `,
      [user.id, user.staffNumber, user.name, user.role, pinHash, user.active],
    )
  }

  const userIds = data.users.map((user) => user.id)

  if (userIds.length > 0) {
    await client.query('DELETE FROM user_credentials WHERE NOT (id = ANY($1::text[]))', [
      userIds,
    ])
  }
}

const replaceStoreWithClient = async (
  pool: pg.Pool,
  data: AppData,
  options: ReplaceStoreOptions = {},
): Promise<ReplaceStoreResult> => {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const current = await client.query<{ revision: string }>(
      'SELECT revision FROM store_snapshots WHERE id = $1 FOR UPDATE',
      [STORE_ID],
    )
    const currentRevision = Number(current.rows[0]?.revision ?? 0)

    if (
      options.expectedRevision != null &&
      current.rowCount !== 0 &&
      options.expectedRevision !== currentRevision
    ) {
      throw new Error(
        `Store changed on another counter. Reload before saving. Current revision is ${currentRevision}.`,
      )
    }

    await upsertCredentials(client, data)

    const nextRevision = currentRevision + 1
    await client.query(
      `
        INSERT INTO store_snapshots (id, data, revision, updated_at)
        VALUES ($1, $2::jsonb, $3, NOW())
        ON CONFLICT (id) DO UPDATE SET
          data = EXCLUDED.data,
          revision = EXCLUDED.revision,
          updated_at = EXCLUDED.updated_at
      `,
      [STORE_ID, JSON.stringify(sanitizeUsers(data)), nextRevision],
    )

    await client.query('COMMIT')

    return { revision: nextRevision }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const createPostgresStore = async (): Promise<DataStore> => {
  const pool = createPool()

  await ensureSchema(pool)
  await seedIfEmpty(pool)

  const authenticateUser = async (staffNumber: string, pin: string) => {
    const result = await pool.query<CredentialRow>(
      `
        SELECT id, staff_number, name, role, pin_hash, active
        FROM user_credentials
        WHERE staff_number = $1
      `,
      [staffNumber],
    )
    const row = result.rows[0]

    if (!row?.active || !row.pin_hash || !verifyPinHash(pin, row.pin_hash)) {
      return null
    }

    return {
      id: row.id,
      staffNumber: row.staff_number,
      name: row.name,
      role: row.role,
      pin: '',
      active: true,
    }
  }

  return {
    authenticateUser,
    getDatabaseInfo: async (): Promise<StoreInfo> => {
      const productCount = await pool.query<{ count: string }>(
        `
          SELECT COALESCE(jsonb_array_length(data -> 'products'), 0)::text AS count
          FROM store_snapshots
          WHERE id = $1
        `,
        [STORE_ID],
      )

      return {
        engine: 'postgres',
        location: databaseUrl ? databaseUrl.replace(/:\/\/.*@/, '://***@') : 'PostgreSQL',
        productCount: { count: Number(productCount.rows[0]?.count ?? 0) },
        revision: await getRevision(pool),
        schemaVersion: SCHEMA_VERSION,
      }
    },
    loadStore: async () => {
      const result = await pool.query<{ data: AppData }>(
        'SELECT data FROM store_snapshots WHERE id = $1',
        [STORE_ID],
      )

      return sanitizeUsers(result.rows[0]?.data ?? initialData)
    },
    replaceStore: (data, options) => replaceStoreWithClient(pool, data, options),
    resetStore: async () => {
      await replaceStoreWithClient(pool, initialData)

      return sanitizeUsers(initialData)
    },
    unlockUser: async (userId, pin) => {
      const result = await pool.query<{ staff_number: string }>(
        'SELECT staff_number FROM user_credentials WHERE id = $1 AND active = TRUE',
        [userId],
      )
      const staffNumber = result.rows[0]?.staff_number

      return staffNumber ? authenticateUser(staffNumber, pin) : null
    },
  }
}
