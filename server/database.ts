import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { initialData } from '../src/data/seed'
import { hashPin, verifyPinHash } from './pin-security'
import type {
  AppData,
  AuditLog,
  CashierShift,
  DebtTransaction,
  Debtor,
  EfrisTransaction,
  Payment,
  Product,
  PurchaseOrder,
  PurchaseOrderItem,
  ReturnRecord,
  Sale,
  SaleItem,
  StockMovement,
  User,
} from '../src/domain/types'

const databasePath = process.env.BUVO_DB_PATH ?? join(process.cwd(), 'data', 'buvo-pos.sqlite')
const SCHEMA_VERSION = 3

const boolToInt = (value: boolean) => (value ? 1 : 0)
const intToBool = (value: number) => value === 1
const optional = <T>(value: T | undefined) => value ?? null
const maybeString = (value: unknown) => (typeof value === 'string' ? value : undefined)
const maybeNumber = (value: unknown) => (typeof value === 'number' ? value : undefined)

type Row = Record<string, unknown>

const getColumns = (table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (column) => column.name,
  )

mkdirSync(dirname(databasePath), { recursive: true })

const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS store_meta (
    id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    supplier TEXT NOT NULL,
    internal_barcode TEXT,
    unit_cost REAL NOT NULL,
    unit_price REAL NOT NULL,
    tax_rate REAL NOT NULL,
    tax_category TEXT NOT NULL,
    efris_commodity_code TEXT NOT NULL,
    stock_on_hand REAL NOT NULL,
    min_stock REAL NOT NULL,
    expiry_date TEXT,
    active INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS product_barcodes (
    product_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    barcode TEXT NOT NULL,
    PRIMARY KEY (product_id, position),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS movements (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    reference TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    receipt_no TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    cashier_id TEXT NOT NULL,
    cashier_name TEXT NOT NULL,
    shift_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    subtotal REAL NOT NULL,
    discount REAL NOT NULL,
    tax REAL NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL,
    fiscal_status TEXT NOT NULL,
    fiscal_document_number TEXT
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    sale_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    barcode TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    unit_cost REAL NOT NULL,
    tax_rate REAL NOT NULL,
    discount_percent REAL NOT NULL,
    PRIMARY KEY (sale_id, position),
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sale_payments (
    sale_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    id TEXT NOT NULL,
    method TEXT NOT NULL,
    amount REAL NOT NULL,
    reference TEXT,
    status TEXT NOT NULL,
    PRIMARY KEY (sale_id, position),
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS returns (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    sale_id TEXT NOT NULL,
    receipt_no TEXT NOT NULL,
    created_at TEXT NOT NULL,
    cashier_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    amount REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    cashier_id TEXT NOT NULL,
    cashier_name TEXT NOT NULL,
    opening_float REAL NOT NULL,
    counted_cash REAL,
    expected_cash REAL,
    variance REAL,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS debtors (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    credit_limit REAL NOT NULL,
    created_at TEXT NOT NULL,
    active INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS debt_transactions (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    debtor_id TEXT NOT NULL,
    debtor_name TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    created_at TEXT NOT NULL,
    reference TEXT NOT NULL,
    note TEXT,
    sale_id TEXT,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    payment_method TEXT
  );

  CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    order_no TEXT NOT NULL,
    supplier TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expected_at TEXT,
    created_by_id TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    status TEXT NOT NULL,
    total REAL NOT NULL,
    invoice_no TEXT,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS purchase_order_items (
    order_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    barcode TEXT NOT NULL,
    quantity_ordered REAL NOT NULL,
    quantity_received REAL NOT NULL,
    unit_cost REAL NOT NULL,
    PRIMARY KEY (order_id, position),
    FOREIGN KEY (order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    staff_number TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    pin TEXT NOT NULL,
    pin_hash TEXT,
    active INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    details TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS efris_transactions (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    type TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    reference_no TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    fiscal_document_number TEXT,
    retry_count INTEGER NOT NULL,
    last_error TEXT
  );

  CREATE TABLE IF NOT EXISTS list_values (
    kind TEXT NOT NULL,
    position INTEGER NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (kind, position)
  );
`)

const runMigrations = () => {
  const userColumns = getColumns('users')

  if (!userColumns.includes('pin_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN pin_hash TEXT')
  }

  const usersMissingHashes = db
    .prepare("SELECT id, pin FROM users WHERE pin_hash IS NULL OR pin_hash = ''")
    .all() as Array<{ id: string; pin: string }>
  const updateHash = db.prepare("UPDATE users SET pin_hash = @pinHash, pin = '' WHERE id = @id")

  usersMissingHashes.forEach((user) => {
    if (user.pin) {
      updateHash.run({ id: user.id, pinHash: hashPin(user.pin) })
    }
  })

  db.prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (@version, @appliedAt)',
  ).run({ version: SCHEMA_VERSION, appliedAt: new Date().toISOString() })
}

runMigrations()

db.prepare(
  "INSERT OR IGNORE INTO store_meta (id, revision, updated_at) VALUES ('main', 0, @updatedAt)",
).run({ updatedAt: new Date().toISOString() })

const replaceStoreTransaction = db.transaction((data: AppData) => {
  const existingPinHashes = new Map(
    (
      db.prepare('SELECT id, pin_hash FROM users').all() as Array<{
        id: string
        pin_hash: string | null
      }>
    ).map((user) => [user.id, user.pin_hash ?? '']),
  )

  db.exec(`
    DELETE FROM product_barcodes;
    DELETE FROM sale_items;
    DELETE FROM sale_payments;
    DELETE FROM products;
    DELETE FROM movements;
    DELETE FROM sales;
    DELETE FROM returns;
    DELETE FROM shifts;
    DELETE FROM debtors;
    DELETE FROM debt_transactions;
    DELETE FROM purchase_order_items;
    DELETE FROM purchase_orders;
    DELETE FROM users;
    DELETE FROM audit_logs;
    DELETE FROM efris_transactions;
    DELETE FROM list_values;
  `)

  const insertProduct = db.prepare(`
    INSERT INTO products (
      id, position, name, category, supplier, internal_barcode, unit_cost, unit_price,
      tax_rate, tax_category, efris_commodity_code, stock_on_hand, min_stock,
      expiry_date, active
    ) VALUES (
      @id, @position, @name, @category, @supplier, @internalBarcode, @unitCost,
      @unitPrice, @taxRate, @taxCategory, @efrisCommodityCode, @stockOnHand,
      @minStock, @expiryDate, @active
    )
  `)
  const insertBarcode = db.prepare(`
    INSERT INTO product_barcodes (product_id, position, barcode)
    VALUES (@productId, @position, @barcode)
  `)
  data.products.forEach((product, position) => {
    insertProduct.run({
      ...product,
      position,
      internalBarcode: optional(product.internalBarcode),
      expiryDate: optional(product.expiryDate),
      active: boolToInt(product.active),
    })
    product.barcodes.forEach((barcode, barcodePosition) => {
      insertBarcode.run({ productId: product.id, position: barcodePosition, barcode })
    })
  })

  const insertMovement = db.prepare(`
    INSERT INTO movements (
      id, position, product_id, product_name, quantity, reason, created_at,
      reference, user_id, user_name
    ) VALUES (
      @id, @position, @productId, @productName, @quantity, @reason, @createdAt,
      @reference, @userId, @userName
    )
  `)
  data.movements.forEach((movement, position) => insertMovement.run({ ...movement, position }))

  const insertSale = db.prepare(`
    INSERT INTO sales (
      id, position, receipt_no, branch_id, cashier_id, cashier_name, shift_id,
      created_at, subtotal, discount, tax, total, status, fiscal_status,
      fiscal_document_number
    ) VALUES (
      @id, @position, @receiptNo, @branchId, @cashierId, @cashierName, @shiftId,
      @createdAt, @subtotal, @discount, @tax, @total, @status, @fiscalStatus,
      @fiscalDocumentNumber
    )
  `)
  const insertSaleItem = db.prepare(`
    INSERT INTO sale_items (
      sale_id, position, product_id, name, barcode, quantity, unit_price,
      unit_cost, tax_rate, discount_percent
    ) VALUES (
      @saleId, @position, @productId, @name, @barcode, @quantity, @unitPrice,
      @unitCost, @taxRate, @discountPercent
    )
  `)
  const insertSalePayment = db.prepare(`
    INSERT INTO sale_payments (sale_id, position, id, method, amount, reference, status)
    VALUES (@saleId, @position, @id, @method, @amount, @reference, @status)
  `)
  data.sales.forEach((sale, position) => {
    insertSale.run({
      ...sale,
      position,
      fiscalDocumentNumber: optional(sale.fiscalDocumentNumber),
    })
    sale.items.forEach((item, itemPosition) => {
      insertSaleItem.run({ ...item, saleId: sale.id, position: itemPosition })
    })
    sale.payments.forEach((payment, paymentPosition) => {
      insertSalePayment.run({
        ...payment,
        saleId: sale.id,
        position: paymentPosition,
        reference: optional(payment.reference),
      })
    })
  })

  const insertReturn = db.prepare(`
    INSERT INTO returns (
      id, position, sale_id, receipt_no, created_at, cashier_id, reason, amount
    ) VALUES (
      @id, @position, @saleId, @receiptNo, @createdAt, @cashierId, @reason, @amount
    )
  `)
  data.returns.forEach((record, position) => insertReturn.run({ ...record, position }))

  const insertShift = db.prepare(`
    INSERT INTO shifts (
      id, position, opened_at, closed_at, cashier_id, cashier_name, opening_float,
      counted_cash, expected_cash, variance, status
    ) VALUES (
      @id, @position, @openedAt, @closedAt, @cashierId, @cashierName,
      @openingFloat, @countedCash, @expectedCash, @variance, @status
    )
  `)
  data.shifts.forEach((shift, position) => {
    insertShift.run({
      ...shift,
      position,
      closedAt: optional(shift.closedAt),
      countedCash: optional(shift.countedCash),
      expectedCash: optional(shift.expectedCash),
      variance: optional(shift.variance),
    })
  })

  const insertDebtor = db.prepare(`
    INSERT INTO debtors (id, position, name, phone, credit_limit, created_at, active)
    VALUES (@id, @position, @name, @phone, @creditLimit, @createdAt, @active)
  `)
  data.debtors.forEach((debtor, position) => {
    insertDebtor.run({
      ...debtor,
      position,
      phone: optional(debtor.phone),
      active: boolToInt(debtor.active),
    })
  })

  const insertDebtTransaction = db.prepare(`
    INSERT INTO debt_transactions (
      id, position, debtor_id, debtor_name, type, amount, created_at, reference,
      note, sale_id, user_id, user_name, payment_method
    ) VALUES (
      @id, @position, @debtorId, @debtorName, @type, @amount, @createdAt,
      @reference, @note, @saleId, @userId, @userName, @paymentMethod
    )
  `)
  data.debtTransactions.forEach((transaction, position) => {
    insertDebtTransaction.run({
      ...transaction,
      position,
      note: optional(transaction.note),
      saleId: optional(transaction.saleId),
      paymentMethod: optional(transaction.paymentMethod),
    })
  })

  const insertPurchaseOrder = db.prepare(`
    INSERT INTO purchase_orders (
      id, position, order_no, supplier, created_at, expected_at, created_by_id,
      created_by_name, status, total, invoice_no, notes
    ) VALUES (
      @id, @position, @orderNo, @supplier, @createdAt, @expectedAt, @createdById,
      @createdByName, @status, @total, @invoiceNo, @notes
    )
  `)
  const insertPurchaseOrderItem = db.prepare(`
    INSERT INTO purchase_order_items (
      order_id, position, product_id, product_name, barcode, quantity_ordered,
      quantity_received, unit_cost
    ) VALUES (
      @orderId, @position, @productId, @productName, @barcode, @quantityOrdered,
      @quantityReceived, @unitCost
    )
  `)
  ;(data.purchaseOrders ?? []).forEach((order, position) => {
    insertPurchaseOrder.run({
      ...order,
      position,
      expectedAt: optional(order.expectedAt),
      invoiceNo: optional(order.invoiceNo),
      notes: optional(order.notes),
    })
    order.items.forEach((item, itemPosition) => {
      insertPurchaseOrderItem.run({
        ...item,
        orderId: order.id,
        position: itemPosition,
      })
    })
  })

  const insertUser = db.prepare(`
    INSERT INTO users (id, position, staff_number, name, role, pin, pin_hash, active)
    VALUES (@id, @position, @staffNumber, @name, @role, @pin, @pinHash, @active)
  `)
  data.users.forEach((user, position) => {
    const existingPinHash = existingPinHashes.get(user.id)
    const pinHash = user.pin ? hashPin(user.pin) : existingPinHash

    if (!pinHash) {
      throw new Error(`Missing PIN for ${user.name}.`)
    }

    insertUser.run({
      ...user,
      position,
      pin: '',
      pinHash,
      active: boolToInt(user.active),
    })
  })

  const insertAuditLog = db.prepare(`
    INSERT INTO audit_logs (
      id, position, created_at, user_id, user_name, action, entity, details
    ) VALUES (
      @id, @position, @createdAt, @userId, @userName, @action, @entity, @details
    )
  `)
  data.auditLogs.forEach((log, position) => insertAuditLog.run({ ...log, position }))

  const insertEfrisTransaction = db.prepare(`
    INSERT INTO efris_transactions (
      id, position, type, reference_id, reference_no, created_at, status,
      fiscal_document_number, retry_count, last_error
    ) VALUES (
      @id, @position, @type, @referenceId, @referenceNo, @createdAt, @status,
      @fiscalDocumentNumber, @retryCount, @lastError
    )
  `)
  data.efrisTransactions.forEach((transaction, position) => {
    insertEfrisTransaction.run({
      ...transaction,
      position,
      fiscalDocumentNumber: optional(transaction.fiscalDocumentNumber),
      lastError: optional(transaction.lastError),
    })
  })

  const insertListValue = db.prepare(`
    INSERT INTO list_values (kind, position, value)
    VALUES (@kind, @position, @value)
  `)
  data.categories.forEach((value, position) =>
    insertListValue.run({ kind: 'category', position, value }),
  )
  data.suppliers.forEach((value, position) =>
    insertListValue.run({ kind: 'supplier', position, value }),
  )

  db.prepare(
    "UPDATE store_meta SET revision = revision + 1, updated_at = @updatedAt WHERE id = 'main'",
  ).run({ updatedAt: new Date().toISOString() })
})

const selectAll = (sql: string) => db.prepare(sql).all() as Row[]

export const loadStore = (): AppData => {
  const products = selectAll('SELECT * FROM products ORDER BY position').map((row) => ({
    id: String(row.id),
    name: String(row.name),
    category: String(row.category),
    supplier: String(row.supplier),
    barcodes: selectAll(
      `SELECT barcode FROM product_barcodes WHERE product_id = '${String(row.id).replace(
        /'/g,
        "''",
      )}' ORDER BY position`,
    ).map((barcodeRow) => String(barcodeRow.barcode)),
    internalBarcode: maybeString(row.internal_barcode),
    unitCost: Number(row.unit_cost),
    unitPrice: Number(row.unit_price),
    taxRate: Number(row.tax_rate),
    taxCategory: String(row.tax_category),
    efrisCommodityCode: String(row.efris_commodity_code),
    stockOnHand: Number(row.stock_on_hand),
    minStock: Number(row.min_stock),
    expiryDate: maybeString(row.expiry_date),
    active: intToBool(Number(row.active)),
  })) satisfies Product[]

  const movements = selectAll('SELECT * FROM movements ORDER BY position').map((row) => ({
    id: String(row.id),
    productId: String(row.product_id),
    productName: String(row.product_name),
    quantity: Number(row.quantity),
    reason: String(row.reason) as StockMovement['reason'],
    createdAt: String(row.created_at),
    reference: String(row.reference),
    userId: String(row.user_id),
    userName: String(row.user_name),
  })) satisfies StockMovement[]

  const sales = selectAll('SELECT * FROM sales ORDER BY position').map((row) => {
    const saleId = String(row.id)
    const escapedSaleId = saleId.replace(/'/g, "''")
    const items = selectAll(
      `SELECT * FROM sale_items WHERE sale_id = '${escapedSaleId}' ORDER BY position`,
    ).map((itemRow) => ({
      productId: String(itemRow.product_id),
      name: String(itemRow.name),
      barcode: String(itemRow.barcode),
      quantity: Number(itemRow.quantity),
      unitPrice: Number(itemRow.unit_price),
      unitCost: Number(itemRow.unit_cost),
      taxRate: Number(itemRow.tax_rate),
      discountPercent: Number(itemRow.discount_percent),
    })) satisfies SaleItem[]
    const payments = selectAll(
      `SELECT * FROM sale_payments WHERE sale_id = '${escapedSaleId}' ORDER BY position`,
    ).map((paymentRow) => ({
      id: String(paymentRow.id),
      method: String(paymentRow.method) as Payment['method'],
      amount: Number(paymentRow.amount),
      reference: maybeString(paymentRow.reference),
      status: String(paymentRow.status) as Payment['status'],
    })) satisfies Payment[]

    return {
      id: saleId,
      receiptNo: String(row.receipt_no),
      branchId: String(row.branch_id),
      cashierId: String(row.cashier_id),
      cashierName: String(row.cashier_name),
      shiftId: String(row.shift_id),
      createdAt: String(row.created_at),
      items,
      payments,
      subtotal: Number(row.subtotal),
      discount: Number(row.discount),
      tax: Number(row.tax),
      total: Number(row.total),
      status: String(row.status) as Sale['status'],
      fiscalStatus: String(row.fiscal_status) as Sale['fiscalStatus'],
      fiscalDocumentNumber: maybeString(row.fiscal_document_number),
    }
  }) satisfies Sale[]

  const returns = selectAll('SELECT * FROM returns ORDER BY position').map((row) => ({
    id: String(row.id),
    saleId: String(row.sale_id),
    receiptNo: String(row.receipt_no),
    createdAt: String(row.created_at),
    cashierId: String(row.cashier_id),
    reason: String(row.reason),
    amount: Number(row.amount),
  })) satisfies ReturnRecord[]

  const shifts = selectAll('SELECT * FROM shifts ORDER BY position').map((row) => ({
    id: String(row.id),
    openedAt: String(row.opened_at),
    closedAt: maybeString(row.closed_at),
    cashierId: String(row.cashier_id),
    cashierName: String(row.cashier_name),
    openingFloat: Number(row.opening_float),
    countedCash: maybeNumber(row.counted_cash),
    expectedCash: maybeNumber(row.expected_cash),
    variance: maybeNumber(row.variance),
    status: String(row.status) as CashierShift['status'],
  })) satisfies CashierShift[]

  const debtors = selectAll('SELECT * FROM debtors ORDER BY position').map((row) => ({
    id: String(row.id),
    name: String(row.name),
    phone: maybeString(row.phone),
    creditLimit: Number(row.credit_limit),
    createdAt: String(row.created_at),
    active: intToBool(Number(row.active)),
  })) satisfies Debtor[]

  const debtTransactions = selectAll('SELECT * FROM debt_transactions ORDER BY position').map(
    (row) => ({
      id: String(row.id),
      debtorId: String(row.debtor_id),
      debtorName: String(row.debtor_name),
      type: String(row.type) as DebtTransaction['type'],
      amount: Number(row.amount),
      createdAt: String(row.created_at),
      reference: String(row.reference),
      note: maybeString(row.note),
      saleId: maybeString(row.sale_id),
      userId: String(row.user_id),
      userName: String(row.user_name),
      paymentMethod: maybeString(row.payment_method) as DebtTransaction['paymentMethod'],
    }),
  ) satisfies DebtTransaction[]

  const purchaseOrders = selectAll('SELECT * FROM purchase_orders ORDER BY position').map(
    (row) => {
      const orderId = String(row.id)
      const escapedOrderId = orderId.replace(/'/g, "''")
      const items = selectAll(
        `SELECT * FROM purchase_order_items WHERE order_id = '${escapedOrderId}' ORDER BY position`,
      ).map((itemRow) => ({
        productId: String(itemRow.product_id),
        productName: String(itemRow.product_name),
        barcode: String(itemRow.barcode),
        quantityOrdered: Number(itemRow.quantity_ordered),
        quantityReceived: Number(itemRow.quantity_received),
        unitCost: Number(itemRow.unit_cost),
      })) satisfies PurchaseOrderItem[]

      return {
        id: orderId,
        orderNo: String(row.order_no),
        supplier: String(row.supplier),
        createdAt: String(row.created_at),
        expectedAt: maybeString(row.expected_at),
        createdById: String(row.created_by_id),
        createdByName: String(row.created_by_name),
        status: String(row.status) as PurchaseOrder['status'],
        items,
        total: Number(row.total),
        invoiceNo: maybeString(row.invoice_no),
        notes: maybeString(row.notes),
      }
    },
  ) satisfies PurchaseOrder[]

  const users = selectAll('SELECT * FROM users ORDER BY position').map((row) => ({
    id: String(row.id),
    staffNumber: String(row.staff_number),
    name: String(row.name),
    role: String(row.role) as User['role'],
    pin: '',
    active: intToBool(Number(row.active)),
  })) satisfies User[]

  const auditLogs = selectAll('SELECT * FROM audit_logs ORDER BY position').map((row) => ({
    id: String(row.id),
    createdAt: String(row.created_at),
    userId: String(row.user_id),
    userName: String(row.user_name),
    action: String(row.action),
    entity: String(row.entity),
    details: String(row.details),
  })) satisfies AuditLog[]

  const efrisTransactions = selectAll('SELECT * FROM efris_transactions ORDER BY position').map(
    (row) => ({
      id: String(row.id),
      type: String(row.type) as EfrisTransaction['type'],
      referenceId: String(row.reference_id),
      referenceNo: String(row.reference_no),
      createdAt: String(row.created_at),
      status: String(row.status) as EfrisTransaction['status'],
      fiscalDocumentNumber: maybeString(row.fiscal_document_number),
      retryCount: Number(row.retry_count),
      lastError: maybeString(row.last_error),
    }),
  ) satisfies EfrisTransaction[]

  const categories = selectAll(
    "SELECT value FROM list_values WHERE kind = 'category' ORDER BY position",
  ).map((row) => String(row.value))
  const suppliers = selectAll(
    "SELECT value FROM list_values WHERE kind = 'supplier' ORDER BY position",
  ).map((row) => String(row.value))

  return {
    products,
    movements,
    sales,
    returns,
    shifts,
    debtors,
    debtTransactions,
    purchaseOrders,
    users,
    auditLogs,
    efrisTransactions,
    categories,
    suppliers,
  }
}

export const replaceStore = (data: AppData) => {
  replaceStoreTransaction(data)
  return getStoreRevision()
}

export const authenticateUser = (staffNumber: string, pin: string): User | null => {
  const row = db
    .prepare(
      'SELECT id, staff_number, name, role, pin_hash, active FROM users WHERE staff_number = ?',
    )
    .get(staffNumber) as
    | {
        id: string
        staff_number: string
        name: string
        role: User['role']
        pin_hash: string | null
        active: number
      }
    | undefined

  if (!row || !intToBool(row.active) || !row.pin_hash || !verifyPinHash(pin, row.pin_hash)) {
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

export const unlockUser = (userId: string, pin: string): User | null => {
  const row = db
    .prepare('SELECT staff_number FROM users WHERE id = ? AND active = 1')
    .get(userId) as { staff_number: string } | undefined

  return row ? authenticateUser(row.staff_number, pin) : null
}

export const resetStore = () => {
  replaceStore(initialData)
  return loadStore()
}

export const getStoreRevision = () =>
  Number(
    (
      db.prepare("SELECT revision FROM store_meta WHERE id = 'main'").get() as
        | { revision: number }
        | undefined
    )?.revision ?? 0,
  )

export const getDatabaseInfo = () => ({
  engine: 'sqlite',
  location: databasePath,
  path: databasePath,
  productCount: db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number },
  revision: getStoreRevision(),
  schemaVersion: SCHEMA_VERSION,
})

const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get() as {
  count: number
}

if (productCount.count === 0) {
  replaceStore(initialData)
}
