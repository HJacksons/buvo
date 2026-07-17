import type {
  AppData,
  CashierShift,
  DebtTransaction,
  Debtor,
  Product,
  StockMovement,
  User,
} from '../domain/types'

export const BRANCH_ID = 'kampala-main'

const demoCashier: User = {
  id: 'usr-cashier-1',
  staffNumber: '1001',
  name: 'BUVO Counter 1',
  role: 'cashier',
  pin: '1234',
  active: true,
}

const users: User[] = [
  demoCashier,
  {
    id: 'usr-owner',
    staffNumber: '0001',
    name: 'Shop Owner',
    role: 'owner',
    pin: '0000',
    active: true,
  },
  {
    id: 'usr-stock',
    staffNumber: '2001',
    name: 'Stock Administrator',
    role: 'stock-admin',
    pin: '2468',
    active: true,
  },
  {
    id: 'usr-manager',
    staffNumber: '3001',
    name: 'Floor Manager',
    role: 'manager',
    pin: '4321',
    active: true,
  },
]

const products: Product[] = [
  {
    id: 'prd-posho',
    name: 'Nile Star Posho 2kg',
    category: 'Dry foods',
    supplier: 'Kampala Grain Traders',
    barcodes: ['6160001000012', 'BUVO-POSHO-2KG'],
    internalBarcode: 'BUVO-POSHO-2KG',
    unitCost: 4200,
    unitPrice: 5900,
    taxRate: 0.18,
    taxCategory: 'VAT 18%',
    efrisCommodityCode: '1006.30.00',
    stockOnHand: 34,
    minStock: 12,
    expiryDate: '2027-01-30',
    active: true,
  },
  {
    id: 'prd-beans',
    name: 'Pearl Beans 1kg',
    category: 'Dry foods',
    supplier: 'Masindi Produce Co.',
    barcodes: ['6160001000029'],
    unitCost: 3100,
    unitPrice: 4500,
    taxRate: 0.18,
    taxCategory: 'VAT 18%',
    efrisCommodityCode: '0713.33.00',
    stockOnHand: 22,
    minStock: 10,
    expiryDate: '2027-03-12',
    active: true,
  },
  {
    id: 'prd-soap',
    name: 'Blue Fresh Soap 600g',
    category: 'Household',
    supplier: 'Jinja Home Supplies',
    barcodes: ['6160001000036'],
    unitCost: 2600,
    unitPrice: 3900,
    taxRate: 0.18,
    taxCategory: 'VAT 18%',
    efrisCommodityCode: '3401.11.00',
    stockOnHand: 18,
    minStock: 8,
    active: true,
  },
  {
    id: 'prd-milk',
    name: 'BUVO Fresh Milk 500ml',
    category: 'Dairy',
    supplier: 'Mbarara Dairy Farm',
    barcodes: ['BUVO-DAIRY-500'],
    internalBarcode: 'BUVO-DAIRY-500',
    unitCost: 1300,
    unitPrice: 2200,
    taxRate: 0,
    taxCategory: 'Zero-rated',
    efrisCommodityCode: '0401.20.00',
    stockOnHand: 9,
    minStock: 15,
    expiryDate: '2026-08-04',
    active: true,
  },
]

const now = new Date().toISOString()

const movements: StockMovement[] = products.map((product) => ({
  id: `mov-opening-${product.id}`,
  productId: product.id,
  productName: product.name,
  quantity: product.stockOnHand,
  reason: 'opening',
  createdAt: now,
  reference: 'Opening balance',
  userId: 'system',
  userName: 'System',
}))

const shifts: CashierShift[] = [
  {
    id: 'shift-open-1',
    openedAt: now,
    cashierId: demoCashier.id,
    cashierName: demoCashier.name,
    openingFloat: 50000,
    status: 'open',
  },
]

const debtors: Debtor[] = [
  {
    id: 'debtor-nakato',
    name: 'Nakato Family Account',
    phone: '+256 700 111 222',
    creditLimit: 150000,
    createdAt: now,
    active: true,
  },
  {
    id: 'debtor-cafe',
    name: 'Kampala Office Cafe',
    phone: '+256 755 333 444',
    creditLimit: 400000,
    createdAt: now,
    active: true,
  },
]

const debtTransactions: DebtTransaction[] = [
  {
    id: 'debt-opening-nakato',
    debtorId: 'debtor-nakato',
    debtorName: 'Nakato Family Account',
    type: 'charge',
    amount: 42000,
    createdAt: now,
    reference: 'Opening balance',
    note: 'Existing shop credit balance.',
    userId: 'system',
    userName: 'System',
  },
  {
    id: 'debt-payment-cafe',
    debtorId: 'debtor-cafe',
    debtorName: 'Kampala Office Cafe',
    type: 'payment',
    amount: 60000,
    createdAt: now,
    reference: 'Opening payment',
    note: 'Demo repayment record.',
    userId: 'system',
    userName: 'System',
    paymentMethod: 'cash',
  },
  {
    id: 'debt-opening-cafe',
    debtorId: 'debtor-cafe',
    debtorName: 'Kampala Office Cafe',
    type: 'charge',
    amount: 180000,
    createdAt: now,
    reference: 'Opening balance',
    note: 'Existing shop credit balance.',
    userId: 'system',
    userName: 'System',
  },
]

export const initialData: AppData = {
  products,
  movements,
  sales: [],
  returns: [],
  shifts,
  debtors,
  debtTransactions,
  users,
  auditLogs: [
    {
      id: 'audit-start',
      createdAt: now,
      userId: 'system',
      userName: 'System',
      action: 'System ready',
      entity: 'BUVO POS',
      details: 'Initial offline store created.',
    },
  ],
  efrisTransactions: [],
  categories: ['Dry foods', 'Dairy', 'Household', 'Fresh produce', 'Bakery'],
  suppliers: [
    'Kampala Grain Traders',
    'Masindi Produce Co.',
    'Jinja Home Supplies',
    'Mbarara Dairy Farm',
  ],
}
