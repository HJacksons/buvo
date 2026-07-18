import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'

export const hashPin = (pin: string) => {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(pin, salt, 120_000, 32, 'sha256').toString('hex')

  return `pbkdf2_sha256$120000$${salt}$${hash}`
}

export const verifyPinHash = (pin: string, storedHash: string) => {
  const [algorithm, iterationsText, salt, hash] = storedHash.split('$')

  if (algorithm !== 'pbkdf2_sha256' || !iterationsText || !salt || !hash) {
    return false
  }

  const expected = Buffer.from(hash, 'hex')
  const actual = pbkdf2Sync(pin, salt, Number(iterationsText), expected.length, 'sha256')

  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
