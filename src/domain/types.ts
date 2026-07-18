export type PaymentMethod =
  | 'cash'
  | 'mtn-momo'
  | 'airtel-money'
  | 'card'
  | 'split'
  | 'credit'

export type SaleStatus = 'completed' | 'returned' | 'voided'

export type FiscalStatus = 'not-submitted' | 'queued' | 'submitted' | 'failed'

export type StockReason =
  | 'opening'
  | 'purchase'
  | 'sale'
  | 'adjustment'
  | 'return'
  | 'stock-count'
  | 'damage'
  | 'transfer'

export type UserRole = 'owner' | 'manager' | 'stock-admin' | 'cashier'

export type ShiftStatus = 'open' | 'closed'

export type EfrisTransactionType = 'receipt' | 'credit-note' | 'cancelled-receipt'

export type DebtTransactionType = 'charge' | 'payment' | 'adjustment'

export type PurchaseOrderStatus =
  | 'draft'
  | 'sent'
  | 'part-received'
  | 'received'
  | 'cancelled'

export type Product = {
  id: string
  name: string
  category: string
  supplier: string
  barcodes: string[]
  internalBarcode?: string
  unitCost: number
  unitPrice: number
  taxRate: number
  taxCategory: string
  efrisCommodityCode: string
  stockOnHand: number
  minStock: number
  expiryDate?: string
  active: boolean
}

export type CartLine = {
  productId: string
  quantity: number
  discountPercent: number
}

export type Payment = {
  id: string
  method: PaymentMethod
  amount: number
  reference?: string
  status: 'recorded' | 'pending' | 'confirmed'
}

export type SaleItem = {
  productId: string
  name: string
  barcode: string
  quantity: number
  unitPrice: number
  unitCost: number
  taxRate: number
  discountPercent: number
}

export type Sale = {
  id: string
  receiptNo: string
  branchId: string
  cashierId: string
  cashierName: string
  shiftId: string
  createdAt: string
  items: SaleItem[]
  payments: Payment[]
  subtotal: number
  discount: number
  tax: number
  total: number
  status: SaleStatus
  fiscalStatus: FiscalStatus
  fiscalDocumentNumber?: string
}

export type ReturnRecord = {
  id: string
  saleId: string
  receiptNo: string
  createdAt: string
  cashierId: string
  reason: string
  amount: number
}

export type StockMovement = {
  id: string
  productId: string
  productName: string
  quantity: number
  reason: StockReason
  createdAt: string
  reference: string
  userId: string
  userName: string
}

export type CashierShift = {
  id: string
  openedAt: string
  closedAt?: string
  cashierId: string
  cashierName: string
  openingFloat: number
  countedCash?: number
  expectedCash?: number
  variance?: number
  status: ShiftStatus
}

export type User = {
  id: string
  staffNumber: string
  name: string
  role: UserRole
  pin: string
  active: boolean
}

export type AuditLog = {
  id: string
  createdAt: string
  userId: string
  userName: string
  action: string
  entity: string
  details: string
}

export type EfrisTransaction = {
  id: string
  type: EfrisTransactionType
  referenceId: string
  referenceNo: string
  createdAt: string
  status: FiscalStatus
  fiscalDocumentNumber?: string
  retryCount: number
  lastError?: string
}

export type Debtor = {
  id: string
  name: string
  phone?: string
  creditLimit: number
  createdAt: string
  active: boolean
}

export type DebtTransaction = {
  id: string
  debtorId: string
  debtorName: string
  type: DebtTransactionType
  amount: number
  createdAt: string
  reference: string
  note?: string
  saleId?: string
  userId: string
  userName: string
  paymentMethod?: Exclude<PaymentMethod, 'credit' | 'split'>
}

export type PurchaseOrderItem = {
  productId: string
  productName: string
  barcode: string
  quantityOrdered: number
  quantityReceived: number
  unitCost: number
}

export type PurchaseOrder = {
  id: string
  orderNo: string
  supplier: string
  createdAt: string
  expectedAt?: string
  createdById: string
  createdByName: string
  status: PurchaseOrderStatus
  items: PurchaseOrderItem[]
  total: number
  invoiceNo?: string
  notes?: string
}

export type ReceivingDraft = {
  barcode: string
  name: string
  category: string
  supplier: string
  unitCost: string
  unitPrice: string
  quantity: string
  taxRate: string
  taxCategory: string
  efrisCommodityCode: string
  minStock: string
  expiryDate: string
}

export type AppData = {
  products: Product[]
  movements: StockMovement[]
  sales: Sale[]
  returns: ReturnRecord[]
  shifts: CashierShift[]
  debtors: Debtor[]
  debtTransactions: DebtTransaction[]
  purchaseOrders: PurchaseOrder[]
  users: User[]
  auditLogs: AuditLog[]
  efrisTransactions: EfrisTransaction[]
  categories: string[]
  suppliers: string[]
}
