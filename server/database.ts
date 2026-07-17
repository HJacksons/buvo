import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { initialData } from '../src/data/seed'
import type {
  AppData,
  AuditLog,
  CashierShift,
  DebtTransaction,
  Debtor,
  EfrisTransaction,
  Payment,
  Product,
  ReturnRecord,
  Sale,
  SaleItem,
  StockMovement,
  User,
} from '../src/domain/types'

const databasePath = process.env.BUVO_DB_PATH ?? join(process.cwd(), 'data', 'buvo-pos.sqlite')

const boolToInt = (value: boolean) => (value ? 1 : 0)
const intToBool = (value: number) => value === 1
const optional = <T>(value: T | undefined) => value ?? null
const maybeString = (value: unknown) => (typeof value === 'string' ? value : undefined)
const maybeNumber = (value: unknown) => (typeof value === 'number' ? value : undefined)

type Row = Record<string, unknown>

mkdirSync(dirname(databasePath), { recursive: true })

const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
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

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    staff_number TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    pin TEXT NOT NULL,
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

const replaceStoreTransaction = db.transaction((data: AppData) => {
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

  const insertUser = db.prepare(`
    INSERT INTO users (id, position, staff_number, name, role, pin, active)
    VALUES (@id, @position, @staffNumber, @name, @role, @pin, @active)
  `)
  data.users.forEach((user, position) => {
    insertUser.run({ ...user, position, active: boolToInt(user.active) })
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

  const users = selectAll('SELECT * FROM users ORDER BY position').map((row) => ({
    id: String(row.id),
    staffNumber: String(row.staff_number),
    name: String(row.name),
    role: String(row.role) as User['role'],
    pin: String(row.pin),
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
    users,
    auditLogs,
    efrisTransactions,
    categories,
    suppliers,
  }
}

export const replaceStore = (data: AppData) => {
  replaceStoreTransaction(data)
}

export const resetStore = () => {
  replaceStore(initialData)
}

export const getDatabaseInfo = () => ({
  path: databasePath,
  productCount: db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number },
})

const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get() as {
  count: number
}

if (productCount.count === 0) {
  replaceStore(initialData)
}
