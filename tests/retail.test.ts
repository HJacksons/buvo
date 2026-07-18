import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createInternalBarcode,
  createPurchaseOrderNo,
  createReceiptNo,
} from '../src/utils/retail'

test('receipt numbers are stable and padded', () => {
  assert.equal(createReceiptNo(0), 'BUVO-000001')
  assert.equal(createReceiptNo(42), 'BUVO-000043')
})

test('purchase order numbers include date and padded sequence', () => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  assert.equal(createPurchaseOrderNo(6), `PO-${today}-007`)
})

test('internal barcodes avoid existing values', () => {
  const barcode = createInternalBarcode('BUVO Fresh Milk 500ml', [
    'BUVO-FRESH-MILK-500ML-DUP',
  ])

  assert.match(barcode, /^BUVO-FRESH-MILK-500ML-/)
  assert.notEqual(barcode, 'BUVO-FRESH-MILK-500ML-DUP')
})
