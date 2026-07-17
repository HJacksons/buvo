import type { CartLine, Product, SaleItem, UserRole } from '../domain/types'

export const findProductByBarcode = (products: Product[], barcode: string) => {
  const normalized = barcode.trim().toLowerCase()

  return products.find(
    (product) =>
      product.active &&
      product.barcodes.some((code) => code.toLowerCase() === normalized),
  )
}

export const getCartItems = (products: Product[], cart: CartLine[]): SaleItem[] =>
  cart.flatMap((line) => {
    const product = products.find((candidate) => candidate.id === line.productId)

    if (!product) {
      return []
    }

    return {
      productId: product.id,
      name: product.name,
      barcode: product.barcodes[0],
      quantity: line.quantity,
      unitPrice: product.unitPrice,
      unitCost: product.unitCost,
      taxRate: product.taxRate,
      discountPercent: line.discountPercent,
    }
  })

export const getSaleTotals = (items: SaleItem[]) => {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const discount = items.reduce(
    (sum, item) =>
      sum + item.unitPrice * item.quantity * (item.discountPercent / 100),
    0,
  )
  const taxableBase = subtotal - discount
  const tax = items.reduce((sum, item) => {
    const lineSubtotal = item.unitPrice * item.quantity
    const lineDiscount = lineSubtotal * (item.discountPercent / 100)

    return sum + (lineSubtotal - lineDiscount) * item.taxRate
  }, 0)

  return {
    subtotal,
    discount,
    tax,
    total: taxableBase + tax,
  }
}

export const getGrossProfit = (items: SaleItem[]) =>
  items.reduce((sum, item) => {
    const lineRevenue =
      item.unitPrice * item.quantity * (1 - item.discountPercent / 100)

    return sum + (lineRevenue - item.unitCost * item.quantity)
  }, 0)

export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const createReceiptNo = (count: number) =>
  `BUVO-${String(count + 1).padStart(6, '0')}`

export const createInternalBarcode = (
  productName: string,
  existingBarcodes: string[] = [],
) => {
  const slug = productName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/^BUVO-?/, '')
    .slice(0, 18)
  const base = `BUVO-${slug || 'ITEM'}`
  let suffix = Date.now().toString(36).toUpperCase()
  let barcode = `${base}-${suffix}`

  while (existingBarcodes.includes(barcode)) {
    suffix = Math.random().toString(36).slice(2, 8).toUpperCase()
    barcode = `${base}-${suffix}`
  }

  return barcode
}

export const createStaffNumber = (
  role: UserRole,
  existingStaffNumbers: string[] = [],
) => {
  const rolePrefixes: Record<UserRole, string> = {
    owner: '0',
    cashier: '1',
    'stock-admin': '2',
    manager: '3',
  }
  const prefix = rolePrefixes[role]
  const used = new Set(existingStaffNumbers)

  for (let sequence = 1; sequence <= 999; sequence += 1) {
    const staffNumber = `${prefix}${String(sequence).padStart(3, '0')}`

    if (!used.has(staffNumber)) {
      return staffNumber
    }
  }

  let staffNumber = ''

  do {
    staffNumber = `${prefix}${Math.floor(1000 + Math.random() * 9000)}`
  } while (used.has(staffNumber))

  return staffNumber
}
