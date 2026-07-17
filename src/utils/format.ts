import type { PaymentMethod } from '../domain/types'

export const formatMoney = (value: number) =>
  new Intl.NumberFormat('en-UG', {
    style: 'currency',
    currency: 'UGX',
    maximumFractionDigits: 0,
  }).format(value)

export const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('en-UG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))

export const paymentLabels: Record<PaymentMethod, string> = {
  cash: 'Cash',
  'mtn-momo': 'MTN MoMo',
  'airtel-money': 'Airtel Money',
  card: 'Card',
  split: 'Split tender',
  credit: 'Credit account',
}
