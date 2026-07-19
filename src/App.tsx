import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import {
  ArchiveRestore,
  Banknote,
  Bell,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  DatabaseBackup,
  ExternalLink,
  FileClock,
  HandCoins,
  Landmark,
  LayoutDashboard,
  LogOut,
  Minus,
  PackagePlus,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ScanBarcode,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBasket,
  Tag,
  Trash2,
  UserCheck,
  Users,
  WalletCards,
  WifiOff,
} from 'lucide-react'
import './App.css'
import { BRANCH_ID, initialData } from './data/seed'
import {
  authenticateDatabaseUser,
  createBackupPayload,
  loadDatabaseData,
  loadPersistedData,
  normalizeAppData,
  parseBackupPayload,
  saveDatabaseData,
  savePersistedData,
  unlockDatabaseUser,
} from './data/storage'
import type {
  AppData,
  CartLine,
  CashierShift,
  DebtTransaction,
  EfrisTransaction,
  Payment,
  PaymentMethod,
  Product,
  PurchaseOrder,
  PurchaseOrderItem,
  ReceivingDraft,
  Sale,
  StockMovement,
  User,
  UserRole,
} from './domain/types'
import { formatDateTime, formatMoney, paymentLabels } from './utils/format'
import {
  createId,
  createInternalBarcode,
  createPurchaseOrderNo,
  createReceiptNo,
  createStaffNumber,
  findProductByBarcode,
  getCartItems,
  getGrossProfit,
  getSaleTotals,
} from './utils/retail'

type Tab =
  | 'checkout'
  | 'receiving'
  | 'products'
  | 'inventory'
  | 'returns'
  | 'debtors'
  | 'shifts'
  | 'reports'
  | 'notifications'
  | 'monitoring'
  | 'efris'
  | 'admin'

const digitsOnly = (value: string) => value.replace(/\D/g, '')
const sentenceCase = (value: string) =>
  value.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
const csvEscape = (value: string | number | boolean | null | undefined) => {
  const text = value == null ? '' : String(value)

  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }

  return text
}
const INACTIVITY_LOCK_MS = 5 * 60 * 1000
const PRODUCT_PAGE_SIZE = 12
const AUDIT_PAGE_SIZE = 10
const ACTIVITY_PAGE_SIZE = 10
const INVENTORY_PICK_LIMIT = 5
const DEBTOR_PAGE_SIZE = 10
const DEBT_ACTIVITY_PAGE_SIZE = 10
const PURCHASE_PICK_LIMIT = 5
const CUSTOMER_DISPLAY_CHANNEL = 'buvo-customer-display'
const CUSTOMER_DISPLAY_KEY = 'buvo-customer-display-state'
const isShortcutModifier = (event: KeyboardEvent) => event.ctrlKey || event.metaKey
const isModifiedShortcut = (event: KeyboardEvent, key: string) =>
  isShortcutModifier(event) && !event.altKey && event.key.toLowerCase() === key

const emptyReceivingDraft = (barcode = ''): ReceivingDraft => ({
  barcode,
  name: '',
  category: '',
  supplier: '',
  unitCost: '',
  unitPrice: '',
  quantity: '1',
  taxRate: '18',
  taxCategory: 'VAT 18%',
  efrisCommodityCode: '',
  minStock: '5',
  expiryDate: '',
})

type Notification = {
  id: string
  severity: 'info' | 'warning' | 'danger'
  category: string
  title: string
  detail: string
  actionTab: Tab
  actionLabel: string
}

type ProductEditDraft = {
  active: boolean
  barcodes: string
  category: string
  efrisCommodityCode: string
  expiryDate: string
  minStock: string
  name: string
  supplier: string
  taxCategory: string
  taxRate: string
  unitCost: string
  unitPrice: string
}

type PurchaseReceiveDraft = Record<string, string>

type CustomerDisplayLine = {
  barcode: string
  discountPercent: number
  id: string
  lineTotal: number
  name: string
  quantity: number
  unitPrice: number
}

type CustomerDisplayPayload = {
  amountDue: number
  branchName: string
  cashierName: string
  change: number
  discount: number
  lastItem?: {
    barcode: string
    name: string
    unitPrice: number
  }
  lines: CustomerDisplayLine[]
  paid: number
  paymentSummary: string
  receiptNo?: string
  status: 'idle' | 'active' | 'paid'
  subtotal: number
  tax: number
  total: number
  updatedAt: string
}

const emptyCustomerDisplay: CustomerDisplayPayload = {
  amountDue: 0,
  branchName: 'Kampala branch',
  cashierName: '',
  change: 0,
  discount: 0,
  lines: [],
  paid: 0,
  paymentSummary: 'Waiting for checkout',
  status: 'idle',
  subtotal: 0,
  tax: 0,
  total: 0,
  updatedAt: new Date().toISOString(),
}

const createProductEditDraft = (product: Product): ProductEditDraft => ({
  active: product.active,
  barcodes: product.barcodes.join(', '),
  category: product.category,
  efrisCommodityCode: product.efrisCommodityCode,
  expiryDate: product.expiryDate ?? '',
  minStock: String(product.minStock),
  name: product.name,
  supplier: product.supplier,
  taxCategory: product.taxCategory,
  taxRate: String(product.taxRate * 100),
  unitCost: String(product.unitCost),
  unitPrice: String(product.unitPrice),
})

const makeAudit = (
  user: User,
  action: string,
  entity: string,
  details: string,
) => ({
  id: createId('audit'),
  createdAt: new Date().toISOString(),
  userId: user.id,
  userName: user.name,
  action,
  entity,
  details,
})

function App() {
  const isCustomerDisplay =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('display') === 'customer'
  const [initialStore] = useState(loadPersistedData)
  const [data, setData] = useState<AppData>(initialStore.data)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialStore.savedAt)
  const [storageStatus, setStorageStatus] = useState(initialStore.message)
  const [storageMode, setStorageMode] = useState<'browser' | 'database'>('browser')
  const [databaseLabel, setDatabaseLabel] = useState('Database')
  const [isStoreHydrating, setIsStoreHydrating] = useState(true)
  const [sessionUser, setSessionUser] = useState<User | null>(null)
  const [isLocked, setIsLocked] = useState(false)
  const [loginStaffNumber, setLoginStaffNumber] = useState('')
  const [loginPin, setLoginPin] = useState('')
  const [unlockPin, setUnlockPin] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('checkout')
  const [cart, setCart] = useState<CartLine[]>([])
  const [scanCode, setScanCode] = useState('')
  const [receiveScan, setReceiveScan] = useState('')
  const [receivingDraft, setReceivingDraft] = useState<ReceivingDraft>(
    emptyReceivingDraft(),
  )
  const [purchaseSupplier, setPurchaseSupplier] = useState(initialData.suppliers[0] ?? '')
  const [purchaseExpectedAt, setPurchaseExpectedAt] = useState('')
  const [purchaseInvoiceNo, setPurchaseInvoiceNo] = useState('')
  const [purchaseNotes, setPurchaseNotes] = useState('')
  const [purchaseProductSearch, setPurchaseProductSearch] = useState('')
  const [purchaseItems, setPurchaseItems] = useState<PurchaseOrderItem[]>([])
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState(
    initialData.purchaseOrders[0]?.id ?? '',
  )
  const [purchaseReceiveDraft, setPurchaseReceiveDraft] = useState<PurchaseReceiveDraft>(
    {},
  )
  const [productSearch, setProductSearch] = useState('')
  const [returnSaleId, setReturnSaleId] = useState('')
  const [returnReason, setReturnReason] = useState('Customer return')
  const [selectedProductId, setSelectedProductId] = useState(initialData.products[0].id)
  const [productEditDraft, setProductEditDraft] = useState<ProductEditDraft>(
    createProductEditDraft(initialData.products[0]),
  )
  const [inventorySearch, setInventorySearch] = useState('')
  const [stockCountValue, setStockCountValue] = useState('')
  const [stockReason, setStockReason] = useState('stock-count')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [payments, setPayments] = useState<Payment[]>([])
  const [selectedDebtorId, setSelectedDebtorId] = useState(initialData.debtors[0]?.id ?? '')
  const [debtCollectionAmount, setDebtCollectionAmount] = useState('')
  const [debtCollectionMethod, setDebtCollectionMethod] =
    useState<DebtTransaction['paymentMethod']>('cash')
  const [debtCollectionReference, setDebtCollectionReference] = useState('')
  const [debtChargeAmount, setDebtChargeAmount] = useState('')
  const [debtChargeReference, setDebtChargeReference] = useState('')
  const [debtorSearch, setDebtorSearch] = useState('')
  const [debtorPage, setDebtorPage] = useState(1)
  const [debtActivityPage, setDebtActivityPage] = useState(1)
  const [newDebtorName, setNewDebtorName] = useState('')
  const [newDebtorPhone, setNewDebtorPhone] = useState('')
  const [newDebtorLimit, setNewDebtorLimit] = useState('100000')
  const [newDebtorOpeningDebt, setNewDebtorOpeningDebt] = useState('0')
  const [countedCash, setCountedCash] = useState('')
  const [newUserName, setNewUserName] = useState('')
  const [newUserStaffNumber, setNewUserStaffNumber] = useState('')
  const [newUserPin, setNewUserPin] = useState('')
  const [newUserRole, setNewUserRole] = useState<UserRole>('cashier')
  const [activityRoleFilter, setActivityRoleFilter] = useState<UserRole | 'all'>('all')
  const [activityPage, setActivityPage] = useState(1)
  const [productPage, setProductPage] = useState(1)
  const [auditPage, setAuditPage] = useState(1)
  const [lastSale, setLastSale] = useState<Sale | null>(null)
  const [lastCustomerItem, setLastCustomerItem] =
    useState<CustomerDisplayPayload['lastItem']>()
  const [labelProduct, setLabelProduct] = useState<Product | null>(null)
  const [printMode, setPrintMode] = useState<'receipt' | 'label' | null>(null)
  const [printReceiptAfterSale, setPrintReceiptAfterSale] = useState(true)
  const [lastScanAt, setLastScanAt] = useState<string | null>(null)
  const [lastPrintAt, setLastPrintAt] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [status, setStatus] = useState('Offline counter ready.')

  useEffect(() => {
    if (isCustomerDisplay) {
      setIsStoreHydrating(false)
      return
    }

    let cancelled = false

    void loadDatabaseData().then((databaseStore) => {
      if (cancelled) {
        return
      }

      if (databaseStore) {
        setData(databaseStore.data)
        setLastSavedAt(databaseStore.savedAt)
        setStorageStatus(databaseStore.message)
        setStorageMode('database')
        setDatabaseLabel(
          databaseStore.databaseEngine === 'postgres' ? 'PostgreSQL database' : 'SQLite database',
        )
      } else {
        setStorageMode('browser')
      }

      setIsStoreHydrating(false)
    })

    return () => {
      cancelled = true
    }
  }, [isCustomerDisplay])

  useEffect(() => {
    if (isStoreHydrating || isCustomerDisplay) {
      return
    }

    if (storageMode === 'database') {
      void saveDatabaseData(data).then((saveResult) => {
        setStorageStatus(saveResult.message)
        setStorageMode(saveResult.storage === 'database' ? 'database' : 'browser')
        if (saveResult.databaseEngine) {
          setDatabaseLabel(
            saveResult.databaseEngine === 'postgres'
              ? 'PostgreSQL database'
              : 'SQLite database',
          )
        }

        if (saveResult.savedAt) {
          setLastSavedAt(saveResult.savedAt)
        }

        if (!saveResult.ok) {
          setStatus(saveResult.message)
        }
      })
      return
    }

    const saveResult = savePersistedData(data)
    setStorageStatus(saveResult.message)

    if (saveResult.savedAt) {
      setLastSavedAt(saveResult.savedAt)
    }

    if (!saveResult.ok) {
      setStatus(saveResult.message)
    }
  }, [data, isCustomerDisplay, isStoreHydrating, storageMode])

  useEffect(() => {
    setProductPage(1)
  }, [productSearch])

  useEffect(() => {
    setAuditPage(1)
  }, [data.auditLogs.length])

  useEffect(() => {
    setDebtorPage(1)
  }, [debtorSearch])

  useEffect(() => {
    if (!sessionUser || isLocked) {
      return
    }

    let lockTimer = window.setTimeout(() => {
      setIsLocked(true)
      setUnlockPin('')
      setStatus('Session locked after 5 minutes of inactivity.')
      setData((currentData) => ({
        ...currentData,
        auditLogs: [
          makeAudit(
            sessionUser,
            'Session locked',
            sessionUser.name,
            'Automatic inactivity lock.',
          ),
          ...currentData.auditLogs,
        ],
      }))
    }, INACTIVITY_LOCK_MS)

    const resetLockTimer = () => {
      window.clearTimeout(lockTimer)
      lockTimer = window.setTimeout(() => {
        setIsLocked(true)
        setUnlockPin('')
        setStatus('Session locked after 5 minutes of inactivity.')
      }, INACTIVITY_LOCK_MS)
    }
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll']

    events.forEach((eventName) => window.addEventListener(eventName, resetLockTimer))

    return () => {
      window.clearTimeout(lockTimer)
      events.forEach((eventName) =>
        window.removeEventListener(eventName, resetLockTimer),
      )
    }
  }, [isLocked, sessionUser])

  const allowedTabs = useMemo(
    () => (sessionUser ? getAllowedTabs(sessionUser.role) : []),
    [sessionUser],
  )
  const visibleNavItems = navItems.filter((item) => allowedTabs.includes(item.tab))
  const openShift = data.shifts.find(
    (shift) => shift.status === 'open' && shift.cashierId === sessionUser?.id,
  )
  const allOpenShifts = data.shifts.filter((shift) => shift.status === 'open')
  const cartItems = useMemo(() => getCartItems(data.products, cart), [data.products, cart])
  const saleTotals = useMemo(() => getSaleTotals(cartItems), [cartItems])
  const paidTotal = payments.reduce((sum, payment) => sum + payment.amount, 0)
  const amountDue = Math.max(saleTotals.total - paidTotal, 0)
  const todaysSales = data.sales
    .filter((sale) => sale.status === 'completed')
    .reduce((sum, sale) => sum + sale.total, 0)
  const todaysProfit = data.sales
    .filter((sale) => sale.status === 'completed')
    .reduce((sum, sale) => sum + getGrossProfit(sale.items), 0)
  const stockValue = data.products.reduce(
    (sum, product) => sum + product.stockOnHand * product.unitCost,
    0,
  )
  const cashExpected = getExpectedCash(openShift, data.sales, data.debtTransactions)
  const lowStockProducts = data.products.filter(
    (product) => product.stockOnHand <= product.minStock,
  )
  const filteredProducts = data.products.filter((product) => {
    const target = `${product.name} ${product.category} ${product.supplier} ${product.barcodes.join(
      ' ',
    )}`.toLowerCase()

    return target.includes(productSearch.toLowerCase())
  })
  const productPageCount = Math.max(
    1,
    Math.ceil(filteredProducts.length / PRODUCT_PAGE_SIZE),
  )
  const safeProductPage = Math.min(productPage, productPageCount)
  const productPageStart = (safeProductPage - 1) * PRODUCT_PAGE_SIZE
  const pagedProducts = filteredProducts.slice(
    productPageStart,
    productPageStart + PRODUCT_PAGE_SIZE,
  )
  const productShowingFrom = filteredProducts.length === 0 ? 0 : productPageStart + 1
  const productShowingTo = Math.min(
    productPageStart + PRODUCT_PAGE_SIZE,
    filteredProducts.length,
  )
  const inventoryProductMatches = data.products
    .filter((product) => {
      const target = `${product.name} ${product.category} ${product.supplier} ${product.barcodes.join(
        ' ',
      )}`.toLowerCase()

      return target.includes(inventorySearch.toLowerCase())
    })
    .slice(0, INVENTORY_PICK_LIMIT)
  const inventoryMatchCount = data.products.filter((product) => {
    const target = `${product.name} ${product.category} ${product.supplier} ${product.barcodes.join(
      ' ',
    )}`.toLowerCase()

    return target.includes(inventorySearch.toLowerCase())
  }).length
  const auditPageCount = Math.max(1, Math.ceil(data.auditLogs.length / AUDIT_PAGE_SIZE))
  const safeAuditPage = Math.min(auditPage, auditPageCount)
  const auditPageStart = (safeAuditPage - 1) * AUDIT_PAGE_SIZE
  const pagedAuditLogs = data.auditLogs.slice(
    auditPageStart,
    auditPageStart + AUDIT_PAGE_SIZE,
  )
  const auditShowingFrom = data.auditLogs.length === 0 ? 0 : auditPageStart + 1
  const auditShowingTo = Math.min(
    auditPageStart + AUDIT_PAGE_SIZE,
    data.auditLogs.length,
  )
  const debtorsWithBalance = data.debtors.map((debtor) => ({
    ...debtor,
    balance: getDebtorBalance(debtor.id, data.debtTransactions),
  }))
  const filteredDebtors = debtorsWithBalance.filter((debtor) => {
    const target = `${debtor.name} ${debtor.phone ?? ''}`.toLowerCase()

    return target.includes(debtorSearch.toLowerCase())
  })
  const debtorPageCount = Math.max(1, Math.ceil(filteredDebtors.length / DEBTOR_PAGE_SIZE))
  const safeDebtorPage = Math.min(debtorPage, debtorPageCount)
  const debtorPageStart = (safeDebtorPage - 1) * DEBTOR_PAGE_SIZE
  const pagedDebtors = filteredDebtors.slice(
    debtorPageStart,
    debtorPageStart + DEBTOR_PAGE_SIZE,
  )
  const debtorShowingFrom = filteredDebtors.length === 0 ? 0 : debtorPageStart + 1
  const debtorShowingTo = Math.min(
    debtorPageStart + DEBTOR_PAGE_SIZE,
    filteredDebtors.length,
  )
  const selectedDebtor =
    data.debtors.find((debtor) => debtor.id === selectedDebtorId) ?? data.debtors[0]
  const selectedDebtorBalance = selectedDebtor
    ? getDebtorBalance(selectedDebtor.id, data.debtTransactions)
    : 0
  const selectedDebtorAmountOwed = Math.max(selectedDebtorBalance, 0)
  const totalDebt = debtorsWithBalance.reduce(
    (sum, debtor) => sum + Math.max(debtor.balance, 0),
    0,
  )
  const overdueDebtCount = debtorsWithBalance.filter((debtor) => debtor.balance > 0).length
  const debtActivityPageCount = Math.max(
    1,
    Math.ceil(data.debtTransactions.length / DEBT_ACTIVITY_PAGE_SIZE),
  )
  const safeDebtActivityPage = Math.min(debtActivityPage, debtActivityPageCount)
  const debtActivityPageStart = (safeDebtActivityPage - 1) * DEBT_ACTIVITY_PAGE_SIZE
  const pagedDebtTransactions = data.debtTransactions.slice(
    debtActivityPageStart,
    debtActivityPageStart + DEBT_ACTIVITY_PAGE_SIZE,
  )
  const debtActivityShowingFrom =
    data.debtTransactions.length === 0 ? 0 : debtActivityPageStart + 1
  const debtActivityShowingTo = Math.min(
    debtActivityPageStart + DEBT_ACTIVITY_PAGE_SIZE,
    data.debtTransactions.length,
  )
  const purchaseOrderTotal = purchaseItems.reduce(
    (sum, item) => sum + item.quantityOrdered * item.unitCost,
    0,
  )
  const openPurchaseOrders = data.purchaseOrders.filter(
    (order) => order.status !== 'received' && order.status !== 'cancelled',
  )
  const selectedPurchaseOrder =
    data.purchaseOrders.find((order) => order.id === selectedPurchaseOrderId) ??
    openPurchaseOrders[0] ??
    data.purchaseOrders[0]
  const purchaseProductMatches = data.products
    .filter((product) => {
      const target = `${product.name} ${product.category} ${product.supplier} ${product.barcodes.join(
        ' ',
      )}`.toLowerCase()

      return product.active && target.includes(purchaseProductSearch.toLowerCase())
    })
    .slice(0, PURCHASE_PICK_LIMIT)
  const selectedProduct =
    data.products.find((product) => product.id === selectedProductId) ?? data.products[0]

  useEffect(() => {
    if (selectedProduct) {
      setProductEditDraft(createProductEditDraft(selectedProduct))
    }
  }, [selectedProduct])

  const deviceStatus = {
    printer: lastPrintAt ? `Print dialog used ${formatDateTime(lastPrintAt)}` : 'Not verified',
    scanner: lastScanAt ? `Last barcode input ${formatDateTime(lastScanAt)}` : 'Not verified',
  }
  const selectedReturnSale =
    data.sales.find((sale) => sale.id === returnSaleId) ?? data.sales[0] ?? null
  const notifications = useMemo(() => getNotifications(data), [data])
  const urgentNotificationCount = notifications.filter(
    (notification) => notification.severity !== 'info',
  ).length
  const cashierStats = useMemo(() => getCashierStats(data), [data])
  const filteredActivityLogs = useMemo(
    () =>
      data.auditLogs.filter((log) => {
        if (activityRoleFilter === 'all') {
          return true
        }

        return data.users.some(
          (user) => user.id === log.userId && user.role === activityRoleFilter,
        )
      }),
    [activityRoleFilter, data.auditLogs, data.users],
  )
  const activityPageCount = Math.max(
    1,
    Math.ceil(filteredActivityLogs.length / ACTIVITY_PAGE_SIZE),
  )
  const safeActivityPage = Math.min(activityPage, activityPageCount)
  const activityPageStart = (safeActivityPage - 1) * ACTIVITY_PAGE_SIZE
  const pagedActivityLogs = filteredActivityLogs.slice(
    activityPageStart,
    activityPageStart + ACTIVITY_PAGE_SIZE,
  )
  const activityShowingFrom =
    filteredActivityLogs.length === 0 ? 0 : activityPageStart + 1
  const activityShowingTo = Math.min(
    activityPageStart + ACTIVITY_PAGE_SIZE,
    filteredActivityLogs.length,
  )
  const canViewProductCost =
    sessionUser?.role === 'owner' ||
    sessionUser?.role === 'manager' ||
    sessionUser?.role === 'stock-admin'
  const customerDisplayPayload = useMemo(
    () =>
      createCustomerDisplayPayload({
        cartItems,
        lastCustomerItem,
        lastSale,
        paidTotal,
        payments,
        saleTotals,
        sessionUser,
      }),
    [cartItems, lastCustomerItem, lastSale, paidTotal, payments, saleTotals, sessionUser],
  )

  useEffect(() => {
    if (isCustomerDisplay || typeof window === 'undefined') {
      return
    }

    const serialized = JSON.stringify(customerDisplayPayload)
    window.localStorage.setItem(CUSTOMER_DISPLAY_KEY, serialized)

    const channel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL)
    channel.postMessage(customerDisplayPayload)
    channel.close()
  }, [customerDisplayPayload, isCustomerDisplay])

  const commitData = (
    updater: (currentData: AppData) => AppData,
    audit?: { action: string; entity: string; details: string },
  ) => {
    if (!sessionUser) {
      return
    }

    setData((currentData) => {
      const nextData = updater(currentData)

      if (!audit) {
        return nextData
      }

      return {
        ...nextData,
        auditLogs: [
          makeAudit(sessionUser, audit.action, audit.entity, audit.details),
          ...nextData.auditLogs,
        ],
      }
    })
  }

  const downloadCsv = (
    reportName: string,
    headers: string[],
    rows: Array<Array<string | number | boolean | null | undefined>>,
  ) => {
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => csvEscape(value)).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `buvo-${reportName}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    setStatus(`${reportName.replace(/-/g, ' ')} CSV exported.`)
  }

  const exportSalesReport = () => {
    downloadCsv(
      'sales-report',
      [
        'Receipt',
        'Date',
        'Cashier',
        'Status',
        'Fiscal status',
        'Subtotal',
        'Discount',
        'VAT',
        'Total',
        'Payments',
      ],
      data.sales.map((sale) => [
        sale.receiptNo,
        formatDateTime(sale.createdAt),
        sale.cashierName,
        sale.status,
        sale.fiscalStatus,
        sale.subtotal,
        sale.discount,
        sale.tax,
        sale.total,
        sale.payments
          .map((payment) => `${paymentLabels[payment.method]} ${formatMoney(payment.amount)}`)
          .join(' | '),
      ]),
    )
  }

  const exportProductsReport = () => {
    downloadCsv(
      'product-list',
      [
        'Product',
        'Category',
        'Supplier',
        'Barcodes',
        'Stock',
        'Minimum stock',
        'Cost',
        'Price',
        'Tax',
        'EFRIS code',
        'Expiry',
        'Active',
      ],
      data.products.map((product) => [
        product.name,
        product.category,
        product.supplier,
        product.barcodes.join(' | '),
        product.stockOnHand,
        product.minStock,
        product.unitCost,
        product.unitPrice,
        product.taxCategory,
        product.efrisCommodityCode,
        product.expiryDate,
        product.active,
      ]),
    )
  }

  const exportStockMovementsReport = () => {
    downloadCsv(
      'stock-movements',
      ['Date', 'Product', 'Quantity', 'Reason', 'Reference', 'User'],
      data.movements.map((movement) => [
        formatDateTime(movement.createdAt),
        movement.productName,
        movement.quantity,
        movement.reason,
        movement.reference,
        movement.userName,
      ]),
    )
  }

  const exportPurchaseOrdersReport = () => {
    downloadCsv(
      'purchase-orders',
      [
        'Order',
        'Supplier',
        'Created',
        'Expected',
        'Status',
        'Invoice',
        'Product',
        'Barcode',
        'Ordered',
        'Received',
        'Unit cost',
        'Line total',
      ],
      data.purchaseOrders.flatMap((order) =>
        order.items.map((item) => [
          order.orderNo,
          order.supplier,
          formatDateTime(order.createdAt),
          order.expectedAt,
          order.status,
          order.invoiceNo,
          item.productName,
          item.barcode,
          item.quantityOrdered,
          item.quantityReceived,
          item.unitCost,
          item.quantityOrdered * item.unitCost,
        ]),
      ),
    )
  }

  const exportLowStockExpiryReport = () => {
    const expiringProducts = data.products.filter((product) => product.expiryDate)

    downloadCsv(
      'low-stock-expiry',
      ['Product', 'Category', 'Stock', 'Minimum stock', 'Expiry date', 'Supplier'],
      data.products
        .filter((product) => product.stockOnHand <= product.minStock || product.expiryDate)
        .map((product) => [
          product.name,
          product.category,
          product.stockOnHand,
          product.minStock,
          product.expiryDate,
          product.supplier,
        ]),
    )
    setStatus(
      `Low stock and expiry CSV exported (${lowStockProducts.length} low stock, ${expiringProducts.length} with expiry dates).`,
    )
  }

  const exportDebtorsReport = () => {
    downloadCsv(
      'debtors-report',
      ['Debtor', 'Phone', 'Credit limit', 'Balance owed', 'Active'],
      debtorsWithBalance.map((debtor) => [
        debtor.name,
        debtor.phone,
        debtor.creditLimit,
        Math.max(debtor.balance, 0),
        debtor.active,
      ]),
    )
  }

  const exportDebtCollectionsReport = () => {
    downloadCsv(
      'debt-collections',
      ['Date', 'Debtor', 'Type', 'Amount', 'Method', 'Reference', 'User', 'Note'],
      data.debtTransactions.map((transaction) => [
        formatDateTime(transaction.createdAt),
        transaction.debtorName,
        transaction.type,
        transaction.amount,
        transaction.paymentMethod ? paymentLabels[transaction.paymentMethod] : '',
        transaction.reference,
        transaction.userName,
        transaction.note,
      ]),
    )
  }

  const exportShiftReport = () => {
    downloadCsv(
      'shift-report',
      [
        'Cashier',
        'Opened',
        'Closed',
        'Status',
        'Opening float',
        'Expected cash',
        'Counted cash',
        'Variance',
      ],
      data.shifts.map((shift) => [
        shift.cashierName,
        formatDateTime(shift.openedAt),
        shift.closedAt ? formatDateTime(shift.closedAt) : '',
        shift.status,
        shift.openingFloat,
        shift.expectedCash,
        shift.countedCash,
        shift.variance,
      ]),
    )
  }

  const exportEfrisReport = () => {
    downloadCsv(
      'efris-report',
      [
        'Date',
        'Type',
        'Reference',
        'Status',
        'Fiscal document number',
        'Retry count',
        'Last error',
      ],
      data.efrisTransactions.map((transaction) => [
        formatDateTime(transaction.createdAt),
        transaction.type,
        transaction.referenceNo,
        transaction.status,
        transaction.fiscalDocumentNumber,
        transaction.retryCount,
        transaction.lastError,
      ]),
    )
  }

  const exportAuditLog = () => {
    downloadCsv(
      'audit-log',
      ['Date', 'User', 'Action', 'Entity', 'Details'],
      data.auditLogs.map((log) => [
        formatDateTime(log.createdAt),
        log.userName,
        log.action,
        log.entity,
        log.details,
      ]),
    )
  }

  const saveProductEdit = () => {
    if (!sessionUser || sessionUser.role === 'cashier') {
      setStatus('Ask a manager or stock administrator to edit products.')
      return
    }

    if (!selectedProduct) {
      setStatus('Select a product to edit.')
      return
    }

    const unitCost = Number(productEditDraft.unitCost)
    const unitPrice = Number(productEditDraft.unitPrice)
    const taxRate = Number(productEditDraft.taxRate)
    const minStock = Number(productEditDraft.minStock)
    const barcodes = uniqueList(
      productEditDraft.barcodes
        .split(',')
        .map((barcode) => barcode.trim())
        .filter(Boolean),
    )

    if (!productEditDraft.name.trim() || !productEditDraft.category.trim()) {
      setStatus('Product name and category are required.')
      return
    }

    if (
      [unitCost, unitPrice, taxRate, minStock].some((value) => Number.isNaN(value) || value < 0)
    ) {
      setStatus('Enter valid product prices, tax, and minimum stock.')
      return
    }

    if (barcodes.length === 0) {
      setStatus('At least one product barcode is required.')
      return
    }

    const duplicateBarcode = data.products.some(
      (product) =>
        product.id !== selectedProduct.id &&
        product.barcodes.some((barcode) => barcodes.includes(barcode)),
    )

    if (duplicateBarcode) {
      setStatus('One of these barcodes is already used by another product.')
      return
    }

    const priceChanged =
      selectedProduct.unitCost !== unitCost || selectedProduct.unitPrice !== unitPrice
    const activeChanged = selectedProduct.active !== productEditDraft.active
    const details = [
      priceChanged
        ? `Cost ${formatMoney(selectedProduct.unitCost)} -> ${formatMoney(unitCost)}, price ${formatMoney(
            selectedProduct.unitPrice,
          )} -> ${formatMoney(unitPrice)}`
        : 'Product details updated',
      activeChanged
        ? `Status ${selectedProduct.active ? 'active' : 'inactive'} -> ${
            productEditDraft.active ? 'active' : 'inactive'
          }`
        : '',
    ]
      .filter(Boolean)
      .join('. ')

    const updatedProduct: Product = {
      ...selectedProduct,
      active: productEditDraft.active,
      barcodes,
      category: productEditDraft.category.trim(),
      efrisCommodityCode: productEditDraft.efrisCommodityCode.trim(),
      expiryDate: productEditDraft.expiryDate || undefined,
      minStock,
      name: productEditDraft.name.trim(),
      supplier: productEditDraft.supplier.trim(),
      taxCategory: productEditDraft.taxCategory.trim(),
      taxRate: taxRate / 100,
      unitCost,
      unitPrice,
    }

    commitData(
      (currentData) => ({
        ...currentData,
        categories: uniqueList([...currentData.categories, updatedProduct.category]),
        products: currentData.products.map((product) =>
          product.id === updatedProduct.id ? updatedProduct : product,
        ),
        suppliers: uniqueList([...currentData.suppliers, updatedProduct.supplier]),
      }),
      {
        action: priceChanged ? 'Price updated' : 'Product updated',
        entity: updatedProduct.name,
        details,
      },
    )
    setStatus(`${updatedProduct.name} saved.`)
  }

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    let user: User | null = null

    if (storageMode === 'database') {
      const authResult = await authenticateDatabaseUser(loginStaffNumber.trim(), loginPin)
      user = authResult.user
    } else {
      user =
        data.users.find((candidate) => candidate.staffNumber === loginStaffNumber.trim()) ??
        null
    }

    if (!user || !user.active || (storageMode !== 'database' && user.pin !== loginPin)) {
      setStatus('Incorrect staff number, PIN, or inactive user.')
      return
    }

    setSessionUser(user)
    setIsLocked(false)
    setActiveTab(getDefaultTab(user.role))
    setLoginPin('')
    setLoginStaffNumber('')
    setUnlockPin('')
    setStatus(`${user.name} logged in as ${roleLabels[user.role]}.`)
    setData((currentData) => ({
      ...currentData,
      auditLogs: [
        makeAudit(user, 'Login', user.name, `${roleLabels[user.role]} session started.`),
        ...currentData.auditLogs,
      ],
    }))
  }

  const handleLogout = () => {
    if (sessionUser) {
      setData((currentData) => ({
        ...currentData,
        auditLogs: [
          makeAudit(sessionUser, 'Logout', sessionUser.name, 'Session ended.'),
          ...currentData.auditLogs,
        ],
      }))
    }

    setSessionUser(null)
    setIsLocked(false)
    setCart([])
    setPayments([])
    setLastSale(null)
    setUnlockPin('')
    setStatus('Logged out.')
  }

  const handleUnlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!sessionUser) {
      setStatus('Log in before unlocking.')
      return
    }

    const unlockedUser =
      storageMode === 'database'
        ? (await unlockDatabaseUser(sessionUser.id, unlockPin)).user
        : sessionUser.pin === unlockPin
          ? sessionUser
          : null

    if (!unlockedUser) {
      setStatus('Incorrect unlock PIN.')
      return
    }

    setIsLocked(false)
    setUnlockPin('')
    setStatus(`${unlockedUser.name} unlocked.`)
    setData((currentData) => ({
      ...currentData,
      auditLogs: [
        makeAudit(unlockedUser, 'Session unlocked', unlockedUser.name, 'PIN unlock.'),
        ...currentData.auditLogs,
      ],
    }))
  }

  const goToTab = (tab: Tab) => {
    if (!allowedTabs.includes(tab)) {
      setStatus('This role cannot access that area.')
      return
    }

    setActiveTab(tab)
  }

  const addProductToCart = (product: Product) => {
    const quantityAlreadyInCart =
      cart.find((line) => line.productId === product.id)?.quantity ?? 0

    if (quantityAlreadyInCart + 1 > product.stockOnHand) {
      setStatus(`${product.name} has no more available stock.`)
      return
    }

    setCart((currentCart) => {
      const existing = currentCart.find((line) => line.productId === product.id)

      if (existing) {
        return currentCart.map((line) =>
          line.productId === product.id
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        )
      }

      return [...currentCart, { productId: product.id, quantity: 1, discountPercent: 0 }]
    })
    setLastCustomerItem({
      barcode: product.barcodes[0] ?? product.internalBarcode ?? '',
      name: product.name,
      unitPrice: product.unitPrice,
    })
    setStatus(`${product.name} added to basket.`)
  }

  const handleCheckoutScan = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const barcode = scanCode.trim()

    if (!barcode) {
      return
    }

    setLastScanAt(new Date().toISOString())
    const product = findProductByBarcode(data.products, barcode)

    if (!product) {
      setReceiveScan(barcode)
      setReceivingDraft(emptyReceivingDraft(barcode))
      setScanCode('')

      if (allowedTabs.includes('receiving')) {
        setActiveTab('receiving')
        setStatus(`No product found for ${barcode}; receiving form opened.`)
      } else {
        setStatus(`No product found for ${barcode}. Ask stock admin or manager to add it.`)
      }

      return
    }

    addProductToCart(product)
    setScanCode('')
  }

  const updateCartQuantity = (productId: string, nextQuantity: number) => {
    const product = data.products.find((candidate) => candidate.id === productId)

    if (!product || nextQuantity <= 0) {
      setCart((currentCart) =>
        currentCart.filter((line) => line.productId !== productId),
      )
      return
    }

    setCart((currentCart) =>
      currentCart.map((line) =>
        line.productId === productId
          ? { ...line, quantity: Math.min(nextQuantity, product.stockOnHand) }
          : line,
      ),
    )
  }

  const updateLineDiscount = (productId: string, discountPercent: number) => {
    setCart((currentCart) =>
      currentCart.map((line) =>
        line.productId === productId
          ? { ...line, discountPercent: Math.min(Math.max(discountPercent, 0), 100) }
          : line,
      ),
    )
  }

  const addPayment = () => {
    const amount = Number(paymentAmount || amountDue)

    if (amount <= 0) {
      setStatus('Enter a payment amount.')
      return
    }

    if (paymentMethod === 'split') {
      setStatus('For split tender, choose each actual method and add it separately.')
      return
    }

    if (paymentMethod === 'credit' && !selectedDebtor) {
      setStatus('Select a debtor account before adding credit.')
      return
    }

    setPayments((currentPayments) => [
      ...currentPayments,
      {
        id: createId('pay'),
        method: paymentMethod,
        amount,
        reference: paymentReference || undefined,
        status: paymentMethod === 'cash' ? 'recorded' : 'pending',
      },
    ])
    setPaymentMethod('cash')
    setPaymentAmount('')
    setPaymentReference('')
    setStatus(`${formatMoney(amount)} recorded.`)
  }

  const completeSale = () => {
    if (!sessionUser) {
      setStatus('Log in before selling.')
      return
    }

    if (!openShift) {
      setStatus('Open a cashier shift before selling.')
      setActiveTab('shifts')
      return
    }

    if (!cartItems.length) {
      setStatus('Basket is empty.')
      return
    }

    if (paymentMethod === 'split' && payments.length === 0) {
      setStatus('Split tender needs at least two recorded payment lines.')
      return
    }

    const salePayments =
      payments.length > 0
        ? payments
        : [
            {
              id: createId('pay'),
              method: paymentMethod,
              amount: saleTotals.total,
              reference: paymentReference || undefined,
              status: paymentMethod === 'cash' ? 'recorded' : 'pending',
            } satisfies Payment,
          ]

    const tendered = salePayments.reduce((sum, payment) => sum + payment.amount, 0)

    if (tendered < saleTotals.total) {
      setStatus(`Payment is short by ${formatMoney(saleTotals.total - tendered)}.`)
      return
    }

    const creditAmount = salePayments
      .filter((payment) => payment.method === 'credit')
      .reduce((sum, payment) => sum + payment.amount, 0)

    if (creditAmount > 0 && !selectedDebtor) {
      setStatus('Select a debtor account before completing a credit sale.')
      return
    }

    if (
      creditAmount > 0 &&
      selectedDebtor &&
      selectedDebtorBalance + creditAmount > selectedDebtor.creditLimit
    ) {
      setStatus(`${selectedDebtor.name} would exceed their credit limit.`)
      return
    }

    const sale: Sale = {
      id: createId('sale'),
      receiptNo: createReceiptNo(data.sales.length),
      branchId: BRANCH_ID,
      cashierId: sessionUser.id,
      cashierName: sessionUser.name,
      shiftId: openShift.id,
      createdAt: new Date().toISOString(),
      items: cartItems,
      payments: salePayments,
      status: 'completed',
      fiscalStatus: 'queued',
      ...saleTotals,
    }

    const saleMovements: StockMovement[] = cartItems.map((item) => ({
      id: createId('mov-sale'),
      productId: item.productId,
      productName: item.name,
      quantity: -item.quantity,
      reason: 'sale',
      createdAt: sale.createdAt,
      reference: sale.receiptNo,
      userId: sessionUser.id,
      userName: sessionUser.name,
    }))

    const efrisTransaction: EfrisTransaction = {
      id: createId('efris'),
      type: 'receipt',
      referenceId: sale.id,
      referenceNo: sale.receiptNo,
      createdAt: sale.createdAt,
      status: 'queued',
      retryCount: 0,
    }
    const debtCharge: DebtTransaction | null =
      creditAmount > 0 && selectedDebtor
        ? {
            id: createId('debt'),
            debtorId: selectedDebtor.id,
            debtorName: selectedDebtor.name,
            type: 'charge',
            amount: creditAmount,
            createdAt: sale.createdAt,
            reference: sale.receiptNo,
            note: 'Credit sale',
            saleId: sale.id,
            userId: sessionUser.id,
            userName: sessionUser.name,
          }
        : null

    commitData(
      (currentData) => ({
        ...currentData,
        products: currentData.products.map((product) => {
          const soldItem = cartItems.find((item) => item.productId === product.id)

          if (!soldItem) {
            return product
          }

          return { ...product, stockOnHand: product.stockOnHand - soldItem.quantity }
        }),
        sales: [sale, ...currentData.sales],
        movements: [...saleMovements, ...currentData.movements],
        efrisTransactions: [efrisTransaction, ...currentData.efrisTransactions],
        debtTransactions: debtCharge
          ? [debtCharge, ...currentData.debtTransactions]
          : currentData.debtTransactions,
      }),
      {
        action: 'Sale completed',
        entity: sale.receiptNo,
        details:
          creditAmount > 0
            ? `${cartItems.length} line(s), ${formatMoney(sale.total)}, ${formatMoney(
                creditAmount,
              )} on credit`
            : `${cartItems.length} line(s), ${formatMoney(sale.total)}`,
      },
    )
    setLastSale(sale)
    setLabelProduct(null)
    setCart([])
    setPayments([])
    setPaymentReference('')

    if (printReceiptAfterSale) {
      setPrintMode('receipt')
      window.setTimeout(() => {
        window.print()
        setLastPrintAt(new Date().toISOString())
      }, 60)
      setStatus(`${sale.receiptNo} completed. Receipt print dialog opened.`)
      return
    }

    setPrintMode(null)
    setStatus(
      creditAmount > 0 && selectedDebtor
        ? `${sale.receiptNo} completed; ${selectedDebtor.name} owes ${formatMoney(
            creditAmount,
          )}.`
        : `${sale.receiptNo} completed and queued for EFRIS.`,
    )
  }

  const handleReceivingScan = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const barcode = receiveScan.trim()

    if (!barcode) {
      return
    }

    setLastScanAt(new Date().toISOString())
    const product = findProductByBarcode(data.products, barcode)

    if (product) {
      setReceivingDraft({
        ...emptyReceivingDraft(barcode),
        name: product.name,
        category: product.category,
        supplier: product.supplier,
        unitCost: String(product.unitCost),
        unitPrice: String(product.unitPrice),
        quantity: '1',
        taxRate: String(product.taxRate * 100),
        taxCategory: product.taxCategory,
        efrisCommodityCode: product.efrisCommodityCode,
        minStock: String(product.minStock),
        expiryDate: product.expiryDate ?? '',
      })
      setStatus(`${product.name} ready to receive.`)
    } else {
      setReceivingDraft(emptyReceivingDraft(barcode))
      setStatus(`New product form opened for ${barcode}.`)
    }
  }

  const generateInternalBarcode = () => {
    const existingBarcodes = data.products.flatMap((product) => product.barcodes)
    const barcode = createInternalBarcode(receivingDraft.name || 'BUVO ITEM', existingBarcodes)
    setReceivingDraft((draft) => ({ ...draft, barcode }))
    setReceiveScan(barcode)
    setStatus(`Internal barcode generated: ${barcode}.`)
  }

  const addPurchaseOrderItem = (product: Product) => {
    const suggestedQuantity = Math.max(product.minStock * 2 - product.stockOnHand, 1)

    setPurchaseSupplier(product.supplier)
    setPurchaseItems((items) => {
      const existingItem = items.find((item) => item.productId === product.id)

      if (existingItem) {
        return items.map((item) =>
          item.productId === product.id
            ? {
                ...item,
                quantityOrdered: item.quantityOrdered + suggestedQuantity,
              }
            : item,
        )
      }

      return [
        ...items,
        {
          productId: product.id,
          productName: product.name,
          barcode: product.barcodes[0] ?? product.internalBarcode ?? '',
          quantityOrdered: suggestedQuantity,
          quantityReceived: 0,
          unitCost: product.unitCost,
        },
      ]
    })
    setPurchaseProductSearch('')
    setStatus(`${product.name} added to supplier order.`)
  }

  const updatePurchaseItem = (
    productId: string,
    field: 'quantityOrdered' | 'unitCost',
    value: string,
  ) => {
    const numberValue = Math.max(Number(value), 0)

    setPurchaseItems((items) =>
      items.map((item) =>
        item.productId === productId
          ? { ...item, [field]: Number.isNaN(numberValue) ? 0 : numberValue }
          : item,
      ),
    )
  }

  const removePurchaseItem = (productId: string) => {
    setPurchaseItems((items) => items.filter((item) => item.productId !== productId))
  }

  const createPurchaseOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!sessionUser || sessionUser.role === 'cashier') {
      setStatus('Ask a manager or stock administrator to create supplier orders.')
      return
    }

    const supplier = purchaseSupplier.trim()
    const validItems = purchaseItems.filter(
      (item) => item.quantityOrdered > 0 && item.unitCost >= 0,
    )

    if (!supplier || validItems.length === 0) {
      setStatus('Choose a supplier and add at least one product.')
      return
    }

    const order: PurchaseOrder = {
      id: createId('po'),
      orderNo: createPurchaseOrderNo(data.purchaseOrders.length),
      supplier,
      createdAt: new Date().toISOString(),
      expectedAt: purchaseExpectedAt || undefined,
      createdById: sessionUser.id,
      createdByName: sessionUser.name,
      status: 'sent',
      items: validItems,
      total: validItems.reduce((sum, item) => sum + item.quantityOrdered * item.unitCost, 0),
      invoiceNo: purchaseInvoiceNo.trim() || undefined,
      notes: purchaseNotes.trim() || undefined,
    }

    commitData(
      (currentData) => ({
        ...currentData,
        purchaseOrders: [order, ...currentData.purchaseOrders],
        suppliers: uniqueList([...currentData.suppliers, supplier]),
      }),
      {
        action: 'Purchase order created',
        entity: order.orderNo,
        details: `${validItems.length} line(s) ordered from ${supplier}.`,
      },
    )
    setSelectedPurchaseOrderId(order.id)
    setPurchaseItems([])
    setPurchaseExpectedAt('')
    setPurchaseInvoiceNo('')
    setPurchaseNotes('')
    setStatus(`${order.orderNo} created for ${supplier}.`)
  }

  const receivePurchaseOrder = () => {
    if (!sessionUser || sessionUser.role === 'cashier') {
      setStatus('Ask a manager or stock administrator to receive supplier orders.')
      return
    }

    if (!selectedPurchaseOrder) {
      setStatus('Select a purchase order first.')
      return
    }

    const receivedLines = selectedPurchaseOrder.items
      .map((item) => {
        const outstanding = Math.max(item.quantityOrdered - item.quantityReceived, 0)
        const typedQuantity = Number(purchaseReceiveDraft[item.productId] ?? outstanding)
        const quantity = Math.min(Math.max(typedQuantity, 0), outstanding)

        return { item, quantity }
      })
      .filter((line) => line.quantity > 0)

    if (receivedLines.length === 0) {
      setStatus('Enter a receiving quantity for at least one order line.')
      return
    }

    const movements = receivedLines.map(({ item, quantity }) =>
      createMovement(
        sessionUser,
        item.productId,
        item.productName,
        quantity,
        'purchase',
        `${selectedPurchaseOrder.orderNo}${purchaseInvoiceNo ? ` / ${purchaseInvoiceNo}` : ''}`,
      ),
    )

    commitData(
      (currentData) => {
        const receivedByProduct = new Map(
          receivedLines.map(({ item, quantity }) => [item.productId, quantity]),
        )

        const purchaseOrders = currentData.purchaseOrders.map((order) => {
          if (order.id !== selectedPurchaseOrder.id) {
            return order
          }

          const items = order.items.map((item) => ({
            ...item,
            quantityReceived:
              item.quantityReceived + (receivedByProduct.get(item.productId) ?? 0),
          }))
          const allReceived = items.every(
            (item) => item.quantityReceived >= item.quantityOrdered,
          )

          return {
            ...order,
            invoiceNo: purchaseInvoiceNo.trim() || order.invoiceNo,
            status: allReceived ? ('received' as const) : ('part-received' as const),
            items,
          }
        })

        return {
          ...currentData,
          products: currentData.products.map((product) => ({
            ...product,
            stockOnHand: product.stockOnHand + (receivedByProduct.get(product.id) ?? 0),
          })),
          movements: [...movements, ...currentData.movements],
          purchaseOrders,
        }
      },
      {
        action: 'Purchase order received',
        entity: selectedPurchaseOrder.orderNo,
        details: `${receivedLines.length} line(s) received into stock.`,
      },
    )
    setPurchaseReceiveDraft({})
    setPurchaseInvoiceNo('')
    setStatus(`${selectedPurchaseOrder.orderNo} received into stock.`)
  }

  const receiveStock = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!sessionUser) {
      setStatus('Log in before receiving stock.')
      return
    }

    const quantity = Math.max(Number(receivingDraft.quantity), 0)
    const barcode = receivingDraft.barcode.trim()
    const productName = receivingDraft.name.trim()

    if (!barcode || !productName || quantity <= 0) {
      setStatus('Enter barcode, product name and quantity.')
      return
    }

    const existingProduct = findProductByBarcode(data.products, barcode)
    const now = new Date().toISOString()
    const reference = `GRN-${now.slice(0, 10)}`

    commitData(
      (currentData) => {
        if (existingProduct) {
          return {
            ...currentData,
            products: currentData.products.map((product) =>
              product.id === existingProduct.id
                ? {
                    ...product,
                    name: productName,
                    category: receivingDraft.category.trim() || product.category,
                    supplier: receivingDraft.supplier.trim() || product.supplier,
                    unitCost: Number(receivingDraft.unitCost),
                    unitPrice: Number(receivingDraft.unitPrice),
                    taxRate: Number(receivingDraft.taxRate) / 100,
                    taxCategory: receivingDraft.taxCategory,
                    efrisCommodityCode: receivingDraft.efrisCommodityCode,
                    minStock: Number(receivingDraft.minStock),
                    expiryDate: receivingDraft.expiryDate || undefined,
                    stockOnHand: product.stockOnHand + quantity,
                  }
                : product,
            ),
            movements: [
              createMovement(
                sessionUser,
                existingProduct.id,
                productName,
                quantity,
                'purchase',
                reference,
              ),
              ...currentData.movements,
            ],
            categories: uniqueList([...currentData.categories, receivingDraft.category]),
            suppliers: uniqueList([...currentData.suppliers, receivingDraft.supplier]),
          }
        }

        const product: Product = {
          id: createId('prd'),
          name: productName,
          category: receivingDraft.category.trim() || 'Uncategorised',
          supplier: receivingDraft.supplier.trim() || 'Walk-in supplier',
          barcodes: [barcode],
          internalBarcode: barcode.startsWith('BUVO-') ? barcode : undefined,
          unitCost: Number(receivingDraft.unitCost),
          unitPrice: Number(receivingDraft.unitPrice),
          taxRate: Number(receivingDraft.taxRate) / 100,
          taxCategory: receivingDraft.taxCategory,
          efrisCommodityCode: receivingDraft.efrisCommodityCode || 'UNMAPPED',
          stockOnHand: quantity,
          minStock: Number(receivingDraft.minStock),
          expiryDate: receivingDraft.expiryDate || undefined,
          active: true,
        }

        return {
          ...currentData,
          products: [product, ...currentData.products],
          movements: [
            createMovement(
              sessionUser,
              product.id,
              product.name,
              quantity,
              'purchase',
              reference,
            ),
            ...currentData.movements,
          ],
          categories: uniqueList([...currentData.categories, product.category]),
          suppliers: uniqueList([...currentData.suppliers, product.supplier]),
        }
      },
      {
        action: existingProduct ? 'Stock received' : 'Product created',
        entity: productName,
        details: `${quantity} unit(s) received from ${receivingDraft.supplier || 'supplier'}`,
      },
    )
    setReceiveScan('')
    setReceivingDraft(emptyReceivingDraft())
    setStatus(`${productName} saved and stock updated.`)
  }

  const processReturn = (mode: 'return' | 'void') => {
    if (!sessionUser) {
      setStatus('Log in before processing returns.')
      return
    }

    if (!selectedReturnSale || selectedReturnSale.status !== 'completed') {
      setStatus('Select a completed receipt.')
      return
    }

    const now = new Date().toISOString()
    const returnAmount = selectedReturnSale.total
    const returnMovements: StockMovement[] = selectedReturnSale.items.map((item) =>
      createMovement(
        sessionUser,
        item.productId,
        item.name,
        item.quantity,
        'return',
        `${mode === 'void' ? 'Void' : 'Return'} ${selectedReturnSale.receiptNo}`,
      ),
    )
    const efrisTransaction: EfrisTransaction = {
      id: createId('efris'),
      type: mode === 'void' ? 'cancelled-receipt' : 'credit-note',
      referenceId: selectedReturnSale.id,
      referenceNo: selectedReturnSale.receiptNo,
      createdAt: now,
      status: 'queued',
      retryCount: 0,
    }
    const relatedDebtCharge = data.debtTransactions.find(
      (transaction) =>
        transaction.saleId === selectedReturnSale.id && transaction.type === 'charge',
    )
    const debtAdjustment: DebtTransaction | null = relatedDebtCharge
      ? {
          id: createId('debt'),
          debtorId: relatedDebtCharge.debtorId,
          debtorName: relatedDebtCharge.debtorName,
          type: 'payment',
          amount: relatedDebtCharge.amount,
          createdAt: now,
          reference: `${mode === 'void' ? 'Void' : 'Return'} ${selectedReturnSale.receiptNo}`,
          note: 'Credit return adjustment',
          saleId: selectedReturnSale.id,
          userId: sessionUser.id,
          userName: sessionUser.name,
        }
      : null

    commitData(
      (currentData) => ({
        ...currentData,
        products: currentData.products.map((product) => {
          const returnedItem = selectedReturnSale.items.find(
            (item) => item.productId === product.id,
          )

          if (!returnedItem) {
            return product
          }

          return { ...product, stockOnHand: product.stockOnHand + returnedItem.quantity }
        }),
        sales: currentData.sales.map((sale) =>
          sale.id === selectedReturnSale.id
            ? { ...sale, status: mode === 'void' ? 'voided' : 'returned' }
            : sale,
        ),
        returns: [
          {
            id: createId('ret'),
            saleId: selectedReturnSale.id,
            receiptNo: selectedReturnSale.receiptNo,
            createdAt: now,
            cashierId: sessionUser.id,
            reason: returnReason,
            amount: returnAmount,
          },
          ...currentData.returns,
        ],
        movements: [...returnMovements, ...currentData.movements],
        efrisTransactions: [efrisTransaction, ...currentData.efrisTransactions],
        debtTransactions: debtAdjustment
          ? [debtAdjustment, ...currentData.debtTransactions]
          : currentData.debtTransactions,
      }),
      {
        action: mode === 'void' ? 'Receipt voided' : 'Return processed',
        entity: selectedReturnSale.receiptNo,
        details: `${formatMoney(returnAmount)}; reason: ${returnReason}`,
      },
    )
    setLastSale(null)
    setStatus(`${selectedReturnSale.receiptNo} ${mode === 'void' ? 'voided' : 'returned'}.`)
  }

  const applyStockCount = () => {
    if (!sessionUser) {
      setStatus('Log in before posting stock adjustments.')
      return
    }

    if (!selectedProduct) {
      return
    }

    const counted = Number(stockCountValue)

    if (Number.isNaN(counted) || counted < 0) {
      setStatus('Enter a valid stock count.')
      return
    }

    const difference = counted - selectedProduct.stockOnHand

    if (difference === 0) {
      setStatus(`${selectedProduct.name} already matches the count.`)
      return
    }

    commitData(
      (currentData) => ({
        ...currentData,
        products: currentData.products.map((product) =>
          product.id === selectedProduct.id ? { ...product, stockOnHand: counted } : product,
        ),
        movements: [
          createMovement(
            sessionUser,
            selectedProduct.id,
            selectedProduct.name,
            difference,
            stockReason === 'damage' ? 'damage' : 'stock-count',
            `Count ${new Date().toISOString().slice(0, 10)}`,
          ),
          ...currentData.movements,
        ],
      }),
      {
        action: 'Stock count posted',
        entity: selectedProduct.name,
        details: `Counted ${counted}; variance ${difference}`,
      },
    )
    setStockCountValue('')
    setStatus(`${selectedProduct.name} adjusted by ${difference}.`)
  }

  const openNewShift = () => {
    if (!sessionUser) {
      setStatus('Log in before opening a shift.')
      return
    }

    if (openShift) {
      setStatus('A shift is already open.')
      return
    }

    const shift: CashierShift = {
      id: createId('shift'),
      openedAt: new Date().toISOString(),
      cashierId: sessionUser.id,
      cashierName: sessionUser.name,
      openingFloat: 50000,
      status: 'open',
    }

    commitData(
      (currentData) => ({ ...currentData, shifts: [shift, ...currentData.shifts] }),
      {
        action: 'Shift opened',
        entity: shift.id,
        details: `${sessionUser.name} opened with ${formatMoney(shift.openingFloat)}`,
      },
    )
    setStatus('New cashier shift opened.')
  }

  const closeShift = () => {
    if (!sessionUser) {
      setStatus('Log in before closing a shift.')
      return
    }

    if (!openShift) {
      setStatus('No open shift to close.')
      return
    }

    const counted = Number(countedCash)

    if (Number.isNaN(counted)) {
      setStatus('Enter counted cash.')
      return
    }

    const expectedCash = getExpectedCash(openShift, data.sales, data.debtTransactions)
    const variance = counted - expectedCash

    commitData(
      (currentData) => ({
        ...currentData,
        shifts: currentData.shifts.map((shift) =>
          shift.id === openShift.id
            ? {
                ...shift,
                status: 'closed',
                closedAt: new Date().toISOString(),
                countedCash: counted,
                expectedCash,
                variance,
              }
            : shift,
        ),
      }),
      {
        action: 'Shift closed',
        entity: openShift.id,
        details: `Expected ${formatMoney(expectedCash)}, counted ${formatMoney(counted)}`,
      },
    )
    setCountedCash('')
    setStatus(`Shift closed with variance ${formatMoney(variance)}.`)
  }

  const addDebtor = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!sessionUser) {
      setStatus('Log in before adding debtor accounts.')
      return
    }

    if (!newDebtorName.trim()) {
      setStatus('Enter debtor name.')
      return
    }

    const creditLimit = Number(newDebtorLimit)
    const openingDebt = Number(newDebtorOpeningDebt || 0)

    if (Number.isNaN(creditLimit) || creditLimit < 0) {
      setStatus('Enter a valid credit limit.')
      return
    }

    if (Number.isNaN(openingDebt) || openingDebt < 0) {
      setStatus('Enter a valid opening debt.')
      return
    }

    if (openingDebt > creditLimit) {
      setStatus('Opening debt cannot exceed the credit limit.')
      return
    }

    const now = new Date().toISOString()
    const debtor = {
      id: createId('debtor'),
      name: newDebtorName.trim(),
      phone: newDebtorPhone.trim() || undefined,
      creditLimit,
      createdAt: now,
      active: true,
    }
    const openingTransaction: DebtTransaction | null =
      openingDebt > 0
        ? {
            id: createId('debt'),
            debtorId: debtor.id,
            debtorName: debtor.name,
            type: 'charge',
            amount: openingDebt,
            createdAt: now,
            reference: 'Opening debt',
            note: 'Opening debtor balance',
            userId: sessionUser.id,
            userName: sessionUser.name,
          }
        : null

    commitData(
      (currentData) => ({
        ...currentData,
        debtors: [debtor, ...currentData.debtors],
        debtTransactions: openingTransaction
          ? [openingTransaction, ...currentData.debtTransactions]
          : currentData.debtTransactions,
      }),
      {
        action: 'Debtor created',
        entity: debtor.name,
        details:
          openingDebt > 0
            ? `Credit limit ${formatMoney(debtor.creditLimit)}, opening debt ${formatMoney(
                openingDebt,
              )}`
            : `Credit limit ${formatMoney(debtor.creditLimit)}`,
      },
    )
    setSelectedDebtorId(debtor.id)
    setDebtActivityPage(1)
    setNewDebtorName('')
    setNewDebtorPhone('')
    setNewDebtorLimit('100000')
    setNewDebtorOpeningDebt('0')
    setStatus(
      openingDebt > 0
        ? `${debtor.name} added with ${formatMoney(openingDebt)} owed.`
        : `${debtor.name} debtor account added.`,
    )
  }

  const recordDebtCharge = () => {
    if (!sessionUser) {
      setStatus('Log in before recording debtor balances.')
      return
    }

    if (!selectedDebtor) {
      setStatus('Select a debtor account.')
      return
    }

    const amount = Number(debtChargeAmount)

    if (Number.isNaN(amount) || amount <= 0) {
      setStatus('Enter the amount owed.')
      return
    }

    if (selectedDebtorAmountOwed + amount > selectedDebtor.creditLimit) {
      setStatus(`${selectedDebtor.name} would exceed their credit limit.`)
      return
    }

    const transaction: DebtTransaction = {
      id: createId('debt'),
      debtorId: selectedDebtor.id,
      debtorName: selectedDebtor.name,
      type: 'adjustment',
      amount,
      createdAt: new Date().toISOString(),
      reference: debtChargeReference || `ADJ-${Date.now().toString(36).toUpperCase()}`,
      note: 'Manual owed amount',
      userId: sessionUser.id,
      userName: sessionUser.name,
    }

    commitData(
      (currentData) => ({
        ...currentData,
        debtTransactions: [transaction, ...currentData.debtTransactions],
      }),
      {
        action: 'Debt recorded',
        entity: selectedDebtor.name,
        details: `${formatMoney(amount)} recorded as owed.`,
      },
    )
    setDebtChargeAmount('')
    setDebtChargeReference('')
    setDebtActivityPage(1)
    setStatus(`${formatMoney(amount)} recorded as owed by ${selectedDebtor.name}.`)
  }

  const collectDebt = () => {
    if (!sessionUser) {
      setStatus('Log in before collecting debts.')
      return
    }

    if (!selectedDebtor) {
      setStatus('Select a debtor account.')
      return
    }

    const amount = Number(debtCollectionAmount)

    if (Number.isNaN(amount) || amount <= 0) {
      setStatus('Enter a collection amount.')
      return
    }

    if (selectedDebtorAmountOwed <= 0) {
      setStatus(`${selectedDebtor.name} has no outstanding debt.`)
      return
    }

    if (amount > selectedDebtorAmountOwed) {
      setStatus(`Collection is above ${selectedDebtor.name}'s balance.`)
      return
    }

    const transaction: DebtTransaction = {
      id: createId('debt'),
      debtorId: selectedDebtor.id,
      debtorName: selectedDebtor.name,
      type: 'payment',
      amount,
      createdAt: new Date().toISOString(),
      reference: debtCollectionReference || `PAY-${Date.now().toString(36).toUpperCase()}`,
      note: 'Debt collection',
      userId: sessionUser.id,
      userName: sessionUser.name,
      paymentMethod: debtCollectionMethod,
    }

    commitData(
      (currentData) => ({
        ...currentData,
        debtTransactions: [transaction, ...currentData.debtTransactions],
      }),
      {
        action: 'Debt collected',
        entity: selectedDebtor.name,
        details: `${formatMoney(amount)} by ${
          debtCollectionMethod ? paymentLabels[debtCollectionMethod] : 'payment'
        }`,
      },
    )
    setDebtCollectionAmount('')
    setDebtCollectionReference('')
    setDebtActivityPage(1)
    setStatus(`${formatMoney(amount)} collected from ${selectedDebtor.name}.`)
  }

  const addUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!sessionUser) {
      setStatus('Log in before adding users.')
      return
    }

    if (!newUserName.trim()) {
      setStatus('Enter a staff name.')
      return
    }

    if (!newUserStaffNumber.trim() || !newUserPin.trim()) {
      setStatus('Enter staff number and PIN.')
      return
    }

    if (data.users.some((user) => user.staffNumber === newUserStaffNumber.trim())) {
      setStatus('That staff number already exists.')
      return
    }

    commitData(
      (currentData) => ({
        ...currentData,
        users: [
          {
            id: createId('usr'),
            staffNumber: newUserStaffNumber.trim(),
            name: newUserName.trim(),
            role: newUserRole,
            pin: newUserPin.trim(),
            active: true,
          },
          ...currentData.users,
        ],
      }),
      {
        action: 'User created',
        entity: newUserName.trim(),
        details: `Role: ${newUserRole}`,
      },
    )
    setNewUserName('')
    setNewUserStaffNumber('')
    setNewUserPin('')
    setStatus(`${newUserName.trim()} added.`)
  }

  const generateStaffNumber = () => {
    const staffNumber = createStaffNumber(
      newUserRole,
      data.users.map((user) => user.staffNumber),
    )

    setNewUserStaffNumber(staffNumber)
    setStatus(`${roleLabels[newUserRole]} staff number ${staffNumber} generated.`)
  }

  const submitEfris = (transactionId: string) => {
    if (!sessionUser) {
      setStatus('Log in before submitting EFRIS records.')
      return
    }

    commitData(
      (currentData) => ({
        ...currentData,
        efrisTransactions: currentData.efrisTransactions.map((transaction) =>
          transaction.id === transactionId
            ? {
                ...transaction,
                status: 'submitted',
                fiscalDocumentNumber:
                  transaction.fiscalDocumentNumber ??
                  `FDN-${Date.now().toString(36).toUpperCase()}`,
                retryCount: transaction.retryCount + 1,
              }
            : transaction,
        ),
        sales: currentData.sales.map((sale) => {
          const transaction = currentData.efrisTransactions.find(
            (candidate) => candidate.id === transactionId,
          )

          if (!transaction || sale.id !== transaction.referenceId) {
            return sale
          }

          return {
            ...sale,
            fiscalStatus: 'submitted',
            fiscalDocumentNumber:
              sale.fiscalDocumentNumber ?? `FDN-${Date.now().toString(36).toUpperCase()}`,
          }
        }),
      }),
      {
        action: 'EFRIS submitted',
        entity: transactionId,
        details: 'Fiscal transaction simulated as submitted.',
      },
    )
    setStatus('EFRIS transaction marked submitted.')
  }

  const backupData = () => {
    const backup = createBackupPayload(data)
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `buvo-pos-backup-${backup.savedAt.slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    setStatus('Backup file downloaded.')
  }

  const restoreData = (event: ChangeEvent<HTMLInputElement>) => {
    const fileInput = event.currentTarget

    if (!sessionUser) {
      setStatus('Log in before restoring backups.')
      fileInput.value = ''
      return
    }

    const file = fileInput.files?.[0]

    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const restored = parseBackupPayload(String(reader.result))
        setData({
          ...restored,
          auditLogs: [
            makeAudit(
              sessionUser,
              'Backup restored',
              file.name,
              'Local JSON backup restored.',
            ),
            ...restored.auditLogs,
          ],
        })
        fileInput.value = ''
        setStatus('Backup restored.')
      } catch {
        fileInput.value = ''
        setStatus('Backup file could not be read.')
      }
    }
    reader.readAsText(file)
  }

  const resetDemoData = () => {
    if (!sessionUser) {
      setStatus('Log in before resetting demo data.')
      return
    }

    setData({
      ...normalizeAppData(initialData),
      auditLogs: [
        makeAudit(sessionUser, 'Demo reset', 'Local store', 'Demo data restored.'),
        ...initialData.auditLogs,
      ],
    })
    setCart([])
    setPayments([])
    setLastSale(null)
    setStatus('Demo data reset.')
  }

  const printReceipt = () => {
    if (!lastSale) {
      setStatus('Select or complete a receipt before printing.')
      return
    }

    setLabelProduct(null)
    setPrintMode('receipt')
    window.setTimeout(() => {
      window.print()
      setLastPrintAt(new Date().toISOString())
    }, 60)
    setStatus(`${lastSale.receiptNo} sent to browser print dialog.`)
  }

  const printLabel = (product: Product) => {
    setLabelProduct(product)
    setPrintMode('label')
    window.setTimeout(() => {
      window.print()
      setLastPrintAt(new Date().toISOString())
      setStatus(`${product.name} label sent to browser print dialog.`)
    }, 50)
  }

  const openCustomerDisplay = () => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(CUSTOMER_DISPLAY_KEY, JSON.stringify(customerDisplayPayload))
    const displayUrl = new URL(window.location.href)
    displayUrl.searchParams.set('display', 'customer')
    displayUrl.hash = ''

    const displayWindow = window.open(
      displayUrl.toString(),
      'buvo-customer-display',
      'popup,width=980,height=720',
    )

    if (!displayWindow) {
      setStatus('Customer display was blocked. Allow popups for BUVO POS and try again.')
      return
    }

    setStatus('Customer display opened. Move that window to the customer screen.')
  }

  useEffect(() => {
    if (isCustomerDisplay || activeTab !== 'checkout' || !sessionUser || isLocked) {
      return
    }

    const handleCheckoutShortcut = (event: KeyboardEvent) => {
      if (event.key === 'F9' || (isShortcutModifier(event) && event.key === 'Enter')) {
        event.preventDefault()
        completeSale()
        return
      }

      if (event.key === 'F10' || isModifiedShortcut(event, 'p')) {
        event.preventDefault()
        printReceipt()
        return
      }

      if (event.key === 'F8' || isModifiedShortcut(event, 'd')) {
        event.preventDefault()
        openCustomerDisplay()
      }
    }

    window.addEventListener('keydown', handleCheckoutShortcut)

    return () => {
      window.removeEventListener('keydown', handleCheckoutShortcut)
    }
  })

  if (isCustomerDisplay) {
    return <CustomerDisplay />
  }

  if (!sessionUser) {
    return (
      <LoginScreen
        loginPin={loginPin}
        loginStaffNumber={loginStaffNumber}
        status={status}
        users={data.users}
        onPinChange={setLoginPin}
        onStaffNumberChange={setLoginStaffNumber}
        onSubmit={handleLogin}
      />
    )
  }

  if (isLocked) {
    return (
      <LockScreen
        onLogout={handleLogout}
        onPinChange={setUnlockPin}
        onSubmit={handleUnlock}
        pin={unlockPin}
        status={status}
        user={sessionUser}
      />
    )
  }

  return (
    <main className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
      <aside className="sidebar" aria-label="BUVO navigation">
        <div className="sidebar-head">
          <div className="brand-lockup">
            <img className="brand-mark" src="/buvo-logo.svg" alt="BUVO" />
            <div>
              <strong>BUVO POS</strong>
              <span>Better Value, Every Day.</span>
            </div>
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <nav className="nav-list">
          {visibleNavItems.map((item) => (
            <NavButton
              key={item.tab}
              icon={item.icon}
              label={item.label}
              active={activeTab === item.tab}
              onClick={() => goToTab(item.tab)}
            />
          ))}
        </nav>

        <div className="shift-panel">
          <span>{openShift ? 'Open shift' : 'No open shift'}</span>
          <strong>{openShift?.cashierName ?? 'Start shift'}</strong>
          <div className="shift-grid">
            <small>Receipts</small>
            <b>{data.sales.length}</b>
            <small>Cash expected</small>
            <b>{formatMoney(cashExpected)}</b>
            <small>Offline</small>
            <b>Saved</b>
          </div>
        </div>

        <div className="device-panel">
          <span>Device status</span>
          <div className="shift-grid">
            <small>Scanner</small>
            <b>{deviceStatus.scanner}</b>
            <small>Printer</small>
            <b>{deviceStatus.printer}</b>
            <small>Codes</small>
            <b>EAN / UPC / Code 128 / QR text</b>
          </div>
        </div>

        <div className="session-panel">
          <span>Logged in as</span>
          <strong>{sessionUser.name}</strong>
          <small>
            {sessionUser.staffNumber} / {roleLabels[sessionUser.role]}
          </small>
          <button type="button" onClick={() => setIsLocked(true)}>
            <UserCheck size={16} />
            Lock
          </button>
          <button type="button" onClick={handleLogout}>
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Kampala branch</p>
            <h1>{getTitle(activeTab)}</h1>
          </div>
          <div className="status-pill">
            <WifiOff size={18} />
            <span>{status}</span>
          </div>
          <button
            className="notification-button"
            type="button"
            onClick={() => goToTab('notifications')}
          >
            <Bell size={18} />
            <span>{urgentNotificationCount}</span>
          </button>
        </header>

        {activeTab === 'checkout' && (
          <section className="screen checkout-grid">
            <div className="checkout-panel">
              <form className="scan-form" onSubmit={handleCheckoutScan}>
                <ScanBarcode size={22} />
                <input
                  autoFocus
                  value={scanCode}
                  onChange={(event) => setScanCode(event.target.value)}
                  placeholder="Scan or type barcode"
                  aria-label="Scan product barcode"
                />
                <button type="submit">Add</button>
              </form>

              <div className="basket-table">
                <div className="table-head checkout-head">
                  <span>Item</span>
                  <span>Qty</span>
                  <span>Discount</span>
                  <span>Total</span>
                  <span></span>
                </div>

                {cartItems.length === 0 ? (
                  <div className="empty-state">Basket waiting for scan.</div>
                ) : (
                  cartItems.map((item) => (
                    <div className="basket-row checkout-row" key={item.productId}>
                      <div>
                        <strong>{item.name}</strong>
                        <small>{item.barcode}</small>
                      </div>
                      <div className="quantity-stepper">
                        <button
                          type="button"
                          aria-label={`Reduce ${item.name}`}
                          onClick={() =>
                            updateCartQuantity(item.productId, item.quantity - 1)
                          }
                        >
                          <Minus size={15} />
                        </button>
                        <span>{item.quantity}</span>
                        <button
                          type="button"
                          aria-label={`Increase ${item.name}`}
                          onClick={() =>
                            updateCartQuantity(item.productId, item.quantity + 1)
                          }
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                      <input
                        className="compact-input"
                        inputMode="numeric"
                        aria-label={`Discount for ${item.name}`}
                        value={item.discountPercent}
                        onChange={(event) =>
                          updateLineDiscount(item.productId, Number(event.target.value))
                        }
                      />
                      <strong>
                        {formatMoney(
                          item.unitPrice *
                            item.quantity *
                            (1 - item.discountPercent / 100),
                        )}
                      </strong>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Remove ${item.name}`}
                        onClick={() => updateCartQuantity(item.productId, 0)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <aside className="summary-panel">
              <TotalsPanel
                subtotal={saleTotals.subtotal}
                discount={saleTotals.discount}
                tax={saleTotals.tax}
                total={saleTotals.total}
              />

              <div className="payment-grid">
                {paymentOptions.map((option) => (
                  <button
                    key={option.method}
                    type="button"
                    className={paymentMethod === option.method ? 'selected' : ''}
                    onClick={() => setPaymentMethod(option.method)}
                  >
                    {option.icon}
                    <span>{paymentLabels[option.method]}</span>
                  </button>
                ))}
              </div>

              {paymentMethod === 'split' && (
                <div className="helper-note">
                  Choose Cash, MoMo, card, or credit for each part, then add each payment line.
                </div>
              )}

              {paymentMethod === 'credit' && (
                <label className="credit-selector">
                  Debtor account
                  <select
                    value={selectedDebtorId}
                    onChange={(event) => setSelectedDebtorId(event.target.value)}
                  >
                    {data.debtors.map((debtor) => (
                      <option key={debtor.id} value={debtor.id}>
                        {debtor.name} - {formatMoney(getDebtorBalance(debtor.id, data.debtTransactions))}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="payment-entry">
                <input
                  inputMode="numeric"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  placeholder={formatMoney(amountDue)}
                  aria-label="Payment amount"
                />
                <input
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  placeholder="Reference"
                  aria-label="Payment reference"
                />
                <button type="button" onClick={addPayment}>
                  Add payment
                </button>
              </div>

              {payments.length > 0 && (
                <div className="mini-list">
                  {payments.map((payment) => (
                    <div key={payment.id}>
                      <span>{paymentLabels[payment.method]}</span>
                      <b>{formatMoney(payment.amount)}</b>
                    </div>
                  ))}
                </div>
              )}

              <div className="receipt-option">
                <label>
                  <input
                    checked={printReceiptAfterSale}
                    type="checkbox"
                    onChange={(event) => setPrintReceiptAfterSale(event.target.checked)}
                  />
                  Print receipt after sale
                </label>
                <small>F9 or Ctrl+Enter</small>
              </div>

              <div className="checkout-actions">
                <button
                  className="primary-action sale-action"
                  type="button"
                  onClick={completeSale}
                >
                  <ReceiptText size={20} />
                  <span>{printReceiptAfterSale ? 'Complete & print' : 'Complete sale'}</span>
                  <kbd>Ctrl+Enter</kbd>
                </button>

                <div className="checkout-action-grid">
                  <button
                    className="secondary-action action-tile"
                    type="button"
                    onClick={printReceipt}
                  >
                    <Printer size={19} />
                    <span>Receipt</span>
                    <kbd>Ctrl+P</kbd>
                  </button>

                  <button
                    className="secondary-action action-tile"
                    type="button"
                    onClick={openCustomerDisplay}
                  >
                    <ExternalLink size={19} />
                    <span>Display</span>
                    <kbd>Ctrl+D</kbd>
                  </button>
                </div>
              </div>

              {lastSale && <ReceiptPreview sale={lastSale} />}
            </aside>
          </section>
        )}

        {activeTab === 'receiving' && (
          <section className="screen receiving-grid">
            <div className="receiving-panel">
              <form className="scan-form" onSubmit={handleReceivingScan}>
                <ScanBarcode size={22} />
                <input
                  value={receiveScan}
                  onChange={(event) => {
                    setReceiveScan(event.target.value)
                    setReceivingDraft((draft) => ({
                      ...draft,
                      barcode: event.target.value,
                    }))
                  }}
                  placeholder="Scan incoming product"
                  aria-label="Scan incoming product"
                />
                <button type="submit">Find</button>
              </form>

              <form className="product-form" onSubmit={receiveStock}>
                <label>
                  Barcode
                  <input
                    value={receivingDraft.barcode}
                    onChange={(event) =>
                      setReceivingDraft((draft) => ({
                        ...draft,
                        barcode: event.target.value,
                      }))
                    }
                  />
                </label>
                <button className="secondary-action align-end" type="button" onClick={generateInternalBarcode}>
                  <Tag size={18} />
                  Internal barcode
                </button>
                <label className="wide-field">
                  Product name
                  <input
                    value={receivingDraft.name}
                    onChange={(event) =>
                      setReceivingDraft((draft) => ({
                        ...draft,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <DataListInput
                  label="Category"
                  value={receivingDraft.category}
                  options={data.categories}
                  onChange={(value) =>
                    setReceivingDraft((draft) => ({ ...draft, category: value }))
                  }
                />
                <DataListInput
                  label="Supplier"
                  value={receivingDraft.supplier}
                  options={data.suppliers}
                  onChange={(value) =>
                    setReceivingDraft((draft) => ({ ...draft, supplier: value }))
                  }
                />
                <NumberInput
                  label="Buying price"
                  value={receivingDraft.unitCost}
                  onChange={(value) =>
                    setReceivingDraft((draft) => ({ ...draft, unitCost: value }))
                  }
                />
                <NumberInput
                  label="Selling price"
                  value={receivingDraft.unitPrice}
                  onChange={(value) =>
                    setReceivingDraft((draft) => ({ ...draft, unitPrice: value }))
                  }
                />
                <NumberInput
                  label="Quantity received"
                  value={receivingDraft.quantity}
                  onChange={(value) =>
                    setReceivingDraft((draft) => ({ ...draft, quantity: value }))
                  }
                />
                <NumberInput
                  label="Tax %"
                  value={receivingDraft.taxRate}
                  onChange={(value) =>
                    setReceivingDraft((draft) => ({ ...draft, taxRate: value }))
                  }
                />
                <label>
                  Tax category
                  <input
                    value={receivingDraft.taxCategory}
                    onChange={(event) =>
                      setReceivingDraft((draft) => ({
                        ...draft,
                        taxCategory: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  EFRIS commodity code
                  <input
                    value={receivingDraft.efrisCommodityCode}
                    onChange={(event) =>
                      setReceivingDraft((draft) => ({
                        ...draft,
                        efrisCommodityCode: event.target.value,
                      }))
                    }
                  />
                </label>
                <NumberInput
                  label="Minimum stock"
                  value={receivingDraft.minStock}
                  onChange={(value) =>
                    setReceivingDraft((draft) => ({ ...draft, minStock: value }))
                  }
                />
                <label>
                  Expiry date
                  <input
                    type="date"
                    value={receivingDraft.expiryDate}
                    onChange={(event) =>
                      setReceivingDraft((draft) => ({
                        ...draft,
                        expiryDate: event.target.value,
                      }))
                    }
                  />
                </label>

                <button className="primary-action wide-field" type="submit">
                  <PackagePlus size={18} />
                  Save receiving
                </button>
              </form>
            </div>

            <div className="receiving-side">
              <section className="report-panel purchase-panel">
                <div className="section-header">
                  <div>
                    <h2>Supplier orders</h2>
                    <p>{openPurchaseOrders.length} open order(s).</p>
                  </div>
                  <b>{formatMoney(purchaseOrderTotal)}</b>
                </div>

                <form className="stack-form" onSubmit={createPurchaseOrder}>
                  <DataListInput
                    label="Supplier"
                    value={purchaseSupplier}
                    options={data.suppliers}
                    onChange={setPurchaseSupplier}
                  />
                  <div className="two-column-fields">
                    <label>
                      Expected date
                      <input
                        type="date"
                        value={purchaseExpectedAt}
                        onChange={(event) => setPurchaseExpectedAt(event.target.value)}
                      />
                    </label>
                    <label>
                      Invoice no.
                      <input
                        value={purchaseInvoiceNo}
                        onChange={(event) => setPurchaseInvoiceNo(event.target.value)}
                        placeholder="Optional"
                      />
                    </label>
                  </div>
                  <label>
                    Search product
                    <input
                      value={purchaseProductSearch}
                      onChange={(event) => setPurchaseProductSearch(event.target.value)}
                      placeholder="Name, barcode or supplier"
                    />
                  </label>
                  {purchaseProductSearch && (
                    <div className="mini-list">
                      {purchaseProductMatches.length === 0 ? (
                        <div className="empty-state">No matching active products.</div>
                      ) : (
                        purchaseProductMatches.map((product) => (
                          <button
                            className="compact-row clickable-row"
                            type="button"
                            key={product.id}
                            onClick={() => addPurchaseOrderItem(product)}
                          >
                            <span>
                              {product.name}
                              <small>{product.barcodes[0] ?? 'No barcode'}</small>
                            </span>
                            <b>{formatMoney(product.unitCost)}</b>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  <div className="mini-list">
                    {purchaseItems.length === 0 ? (
                      <div className="empty-state">Add products to create an order.</div>
                    ) : (
                      purchaseItems.map((item) => (
                        <div className="purchase-line" key={item.productId}>
                          <span>
                            {item.productName}
                            <small>{item.barcode}</small>
                          </span>
                          <input
                            inputMode="numeric"
                            value={String(item.quantityOrdered)}
                            aria-label={`Quantity for ${item.productName}`}
                            onChange={(event) =>
                              updatePurchaseItem(
                                item.productId,
                                'quantityOrdered',
                                event.target.value,
                              )
                            }
                          />
                          <input
                            inputMode="numeric"
                            value={String(item.unitCost)}
                            aria-label={`Unit cost for ${item.productName}`}
                            onChange={(event) =>
                              updatePurchaseItem(
                                item.productId,
                                'unitCost',
                                event.target.value,
                              )
                            }
                          />
                          <button
                            className="secondary-action icon-action"
                            type="button"
                            onClick={() => removePurchaseItem(item.productId)}
                            title={`Remove ${item.productName}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <label>
                    Notes
                    <textarea
                      value={purchaseNotes}
                      onChange={(event) => setPurchaseNotes(event.target.value)}
                      placeholder="Supplier note, payment terms, delivery note"
                    />
                  </label>
                  <button className="primary-action" type="submit">
                    <PackagePlus size={18} />
                    Create supplier order
                  </button>
                </form>
              </section>

              <section className="report-panel purchase-panel">
                <div className="section-header">
                  <div>
                    <h2>Receive from order</h2>
                    <p>{data.purchaseOrders.length} supplier order(s).</p>
                  </div>
                </div>
                {data.purchaseOrders.length === 0 ? (
                  <div className="empty-state">No supplier orders yet.</div>
                ) : (
                  <>
                    <label>
                      Open purchase order
                      <select
                        value={selectedPurchaseOrder?.id ?? ''}
                        onChange={(event) => setSelectedPurchaseOrderId(event.target.value)}
                      >
                        {data.purchaseOrders.map((order) => (
                          <option key={order.id} value={order.id}>
                            {order.orderNo} - {order.supplier} - {order.status}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedPurchaseOrder && (
                      <div className="mini-list loose">
                        {selectedPurchaseOrder.items.map((item) => {
                          const outstanding = Math.max(
                            item.quantityOrdered - item.quantityReceived,
                            0,
                          )

                          return (
                            <div className="purchase-line receive-line" key={item.productId}>
                              <span>
                                {item.productName}
                                <small>
                                  {item.quantityReceived} / {item.quantityOrdered} received
                                </small>
                              </span>
                              <input
                                inputMode="numeric"
                                value={purchaseReceiveDraft[item.productId] ?? String(outstanding)}
                                aria-label={`Receive ${item.productName}`}
                                onChange={(event) =>
                                  setPurchaseReceiveDraft((draft) => ({
                                    ...draft,
                                    [item.productId]: event.target.value,
                                  }))
                                }
                                disabled={outstanding === 0}
                              />
                            </div>
                          )
                        })}
                        <button
                          className="primary-action"
                          type="button"
                          onClick={receivePurchaseOrder}
                          disabled={
                            selectedPurchaseOrder.status === 'received' ||
                            selectedPurchaseOrder.status === 'cancelled'
                          }
                        >
                          <ArchiveRestore size={18} />
                          Receive order stock
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>

              <MovementFeed movements={data.movements.slice(0, 8)} />
            </div>
          </section>
        )}

        {activeTab === 'products' && (
          <section className="screen products-screen">
            <div className="product-list-zone">
              <div className="list-toolbar">
                <div className="search-line">
                  <Search size={19} />
                  <input
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="Search products, barcode, supplier"
                    aria-label="Search products"
                  />
                </div>
                <div className="list-summary">
                  <strong>
                    {productShowingFrom}-{productShowingTo}
                  </strong>
                  <span>
                    of {filteredProducts.length} products / page {safeProductPage} of{' '}
                    {productPageCount}
                  </span>
                </div>
              </div>

              <div
                className={`product-list ${
                  canViewProductCost ? 'cost-visible' : 'cost-hidden'
                }`}
              >
                <div className="product-table-head">
                  <span>Product</span>
                  <span>Barcode</span>
                  <span className="numeric-head">Stock</span>
                  {canViewProductCost && <span className="numeric-head">Buying cost</span>}
                  <span className="numeric-head">Selling price</span>
                  <span>Status</span>
                  <span aria-label="Actions" />
                </div>
                {pagedProducts.length === 0 ? (
                  <div className="empty-state">No products match this search.</div>
                ) : (
                  pagedProducts.map((product) => (
                    <div
                      className={
                        product.id === selectedProductId ? 'product-row selected' : 'product-row'
                      }
                      key={product.id}
                      onClick={() => setSelectedProductId(product.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          setSelectedProductId(product.id)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="product-main-cell">
                        <strong>{product.name}</strong>
                        <small>
                          {product.category} / {product.supplier} / EFRIS{' '}
                          {product.efrisCommodityCode}
                        </small>
                      </span>
                      <span className="barcode-cell">{product.barcodes.join(', ')}</span>
                      <b
                        className={`stock-cell ${
                          product.stockOnHand <= product.minStock ? 'danger-text' : ''
                        }`}
                        data-label="Stock"
                      >
                        {product.stockOnHand}
                      </b>
                      {canViewProductCost && (
                        <span className="money-cell cost-cell" data-label="Buying cost">
                          {formatMoney(product.unitCost)}
                        </span>
                      )}
                      <strong className="money-cell price-cell" data-label="Selling price">
                        {formatMoney(product.unitPrice)}
                      </strong>
                      <span
                        className={
                          product.stockOnHand <= product.minStock
                            ? 'product-status danger-status'
                            : 'product-status'
                        }
                        data-label="Status"
                      >
                        {product.active
                          ? product.stockOnHand <= product.minStock
                            ? 'Low stock'
                            : 'In stock'
                          : 'Inactive'}
                      </span>
                      <button
                        className="secondary-action compact-action"
                        type="button"
                        aria-label={`Print label for ${product.name}`}
                        title="Print label"
                        onClick={(event) => {
                          event.stopPropagation()
                          printLabel(product)
                        }}
                      >
                        <Printer size={18} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <PaginationControls
                label="Products"
                page={safeProductPage}
                pageCount={productPageCount}
                onPrevious={() => setProductPage((page) => Math.max(1, page - 1))}
                onNext={() => setProductPage((page) => Math.min(productPageCount, page + 1))}
              />
            </div>

            <aside className="report-panel product-editor-panel">
              <h2>Product management</h2>
              {selectedProduct ? (
                sessionUser?.role === 'cashier' ? (
                  <div className="selected-account">
                    <span>Selected product</span>
                    <strong>{selectedProduct.name}</strong>
                    <span>Stock</span>
                    <b>{selectedProduct.stockOnHand}</b>
                    <span>Price</span>
                    <b>{formatMoney(selectedProduct.unitPrice)}</b>
                    <span>Status</span>
                    <b>{selectedProduct.active ? 'Active' : 'Inactive'}</b>
                  </div>
                ) : (
                  <div className="stack-form">
                    <label>
                      Product name
                      <input
                        value={productEditDraft.name}
                        onChange={(event) =>
                          setProductEditDraft((draft) => ({
                            ...draft,
                            name: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Barcodes
                      <input
                        value={productEditDraft.barcodes}
                        onChange={(event) =>
                          setProductEditDraft((draft) => ({
                            ...draft,
                            barcodes: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <DataListInput
                      label="Category"
                      value={productEditDraft.category}
                      options={data.categories}
                      onChange={(value) =>
                        setProductEditDraft((draft) => ({ ...draft, category: value }))
                      }
                    />
                    <DataListInput
                      label="Supplier"
                      value={productEditDraft.supplier}
                      options={data.suppliers}
                      onChange={(value) =>
                        setProductEditDraft((draft) => ({ ...draft, supplier: value }))
                      }
                    />
                    <NumberInput
                      label="Buying price"
                      value={productEditDraft.unitCost}
                      onChange={(value) =>
                        setProductEditDraft((draft) => ({ ...draft, unitCost: value }))
                      }
                    />
                    <NumberInput
                      label="Selling price"
                      value={productEditDraft.unitPrice}
                      onChange={(value) =>
                        setProductEditDraft((draft) => ({ ...draft, unitPrice: value }))
                      }
                    />
                    <NumberInput
                      label="Tax %"
                      value={productEditDraft.taxRate}
                      onChange={(value) =>
                        setProductEditDraft((draft) => ({ ...draft, taxRate: value }))
                      }
                    />
                    <label>
                      Tax category
                      <input
                        value={productEditDraft.taxCategory}
                        onChange={(event) =>
                          setProductEditDraft((draft) => ({
                            ...draft,
                            taxCategory: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      EFRIS commodity code
                      <input
                        value={productEditDraft.efrisCommodityCode}
                        onChange={(event) =>
                          setProductEditDraft((draft) => ({
                            ...draft,
                            efrisCommodityCode: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <NumberInput
                      label="Minimum stock"
                      value={productEditDraft.minStock}
                      onChange={(value) =>
                        setProductEditDraft((draft) => ({ ...draft, minStock: value }))
                      }
                    />
                    <label>
                      Expiry date
                      <input
                        type="date"
                        value={productEditDraft.expiryDate}
                        onChange={(event) =>
                          setProductEditDraft((draft) => ({
                            ...draft,
                            expiryDate: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="toggle-line">
                      <input
                        checked={productEditDraft.active}
                        type="checkbox"
                        onChange={(event) =>
                          setProductEditDraft((draft) => ({
                            ...draft,
                            active: event.target.checked,
                          }))
                        }
                      />
                      Active product
                    </label>
                    <button className="primary-action" type="button" onClick={saveProductEdit}>
                      <PackagePlus size={18} />
                      Save product
                    </button>
                  </div>
                )
              ) : (
                <div className="empty-state">Select a product to manage.</div>
              )}
            </aside>
          </section>
        )}

        {activeTab === 'inventory' && (
          <section className="screen inventory-grid">
            <div className="report-panel">
              <h2>Stock count / adjustment</h2>
              <div className="stack-form">
                <label>
                  Search product
                  <input
                    value={inventorySearch}
                    onChange={(event) => setInventorySearch(event.target.value)}
                    placeholder="Name, barcode, supplier"
                  />
                </label>
                <small className="list-hint">
                  Showing {inventoryProductMatches.length} of {inventoryMatchCount} matching
                  products. Type to search the full catalogue.
                </small>
                <div className="inventory-pick-list">
                  {inventoryProductMatches.length === 0 ? (
                    <span>No products found.</span>
                  ) : (
                    inventoryProductMatches.map((product) => (
                      <button
                        className={product.id === selectedProductId ? 'selected' : ''}
                        type="button"
                        key={product.id}
                        onClick={() => {
                          setSelectedProductId(product.id)
                          setInventorySearch(product.name)
                        }}
                      >
                        <span>
                          <strong>{product.name}</strong>
                          <small>{product.barcodes.join(', ')}</small>
                        </span>
                        <b>{product.stockOnHand}</b>
                      </button>
                    ))
                  )}
                </div>
                <label>
                  Current stock
                  <input readOnly value={selectedProduct?.stockOnHand ?? 0} />
                </label>
                <NumberInput
                  label="Counted stock"
                  value={stockCountValue}
                  onChange={setStockCountValue}
                />
                <label>
                  Reason
                  <select
                    value={stockReason}
                    onChange={(event) => setStockReason(event.target.value)}
                  >
                    <option value="stock-count">Stock count</option>
                    <option value="damage">Damage / loss</option>
                  </select>
                </label>
                <button className="primary-action" type="button" onClick={applyStockCount}>
                  <ClipboardList size={18} />
                  Post adjustment
                </button>
              </div>
            </div>

            <MovementFeed movements={data.movements.slice(0, 12)} />
          </section>
        )}

        {activeTab === 'returns' && (
          <section className="screen returns-grid">
            <div className="report-panel">
              <h2>Return / refund</h2>
              <div className="stack-form">
                <label>
                  Receipt
                  <select
                    value={returnSaleId || selectedReturnSale?.id || ''}
                    onChange={(event) => setReturnSaleId(event.target.value)}
                  >
                    {data.sales.map((sale) => (
                      <option key={sale.id} value={sale.id}>
                        {sale.receiptNo} - {formatMoney(sale.total)} - {sale.status}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reason
                  <input
                    value={returnReason}
                    onChange={(event) => setReturnReason(event.target.value)}
                  />
                </label>
                <div className="button-row">
                  <button className="primary-action" type="button" onClick={() => processReturn('return')}>
                    <RotateCcw size={18} />
                    Process return
                  </button>
                  <button className="secondary-action" type="button" onClick={() => processReturn('void')}>
                    Void receipt
                  </button>
                </div>
              </div>
            </div>

            <div className="report-panel">
              <h2>Return history</h2>
              {data.returns.length === 0 ? (
                <div className="empty-state">No returns yet.</div>
              ) : (
                data.returns.map((record) => (
                  <div className="compact-row" key={record.id}>
                    <span>
                      {record.receiptNo}
                      <small>{record.reason}</small>
                    </span>
                    <b>{formatMoney(record.amount)}</b>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {activeTab === 'debtors' && (
          <section className="screen debtors-grid">
            <div className="report-grid debtor-metrics span-two">
              <Metric title="Outstanding debt" value={formatMoney(totalDebt)} />
              <Metric title="Debtor accounts" value={String(data.debtors.length)} />
              <Metric title="Accounts owing" value={String(overdueDebtCount)} />
            </div>

            <div className="report-panel debtor-list-panel">
              <div className="panel-heading">
                <div>
                  <h2>Debtor accounts</h2>
                  <small>
                    Showing {debtorShowingFrom}-{debtorShowingTo} of{' '}
                    {filteredDebtors.length} accounts.
                  </small>
                </div>
                <div className="search-line compact-search">
                  <Search size={18} />
                  <input
                    value={debtorSearch}
                    onChange={(event) => setDebtorSearch(event.target.value)}
                    placeholder="Search debtor"
                    aria-label="Search debtors"
                  />
                </div>
              </div>

              {filteredDebtors.length === 0 ? (
                <div className="empty-state">No debtor accounts match this search.</div>
              ) : (
                pagedDebtors.map((debtor) => (
                  <button
                    className={
                      debtor.id === selectedDebtor?.id ? 'debtor-row selected' : 'debtor-row'
                    }
                    type="button"
                    key={debtor.id}
                    onClick={() => setSelectedDebtorId(debtor.id)}
                  >
                    <div>
                      <strong>{debtor.name}</strong>
                      <small>{debtor.phone ?? 'No phone saved'}</small>
                    </div>
                    <div className="debtor-balance">
                      <small>
                        {debtor.balance < 0
                          ? 'Credit'
                          : debtor.balance > 0
                            ? 'Owes'
                            : 'No debt'}
                      </small>
                      <b className={debtor.balance > 0 ? 'danger-text' : ''}>
                        {formatMoney(Math.abs(debtor.balance))}
                      </b>
                    </div>
                  </button>
                ))
              )}

              <PaginationControls
                label="Debtors"
                page={safeDebtorPage}
                pageCount={debtorPageCount}
                onPrevious={() => setDebtorPage((page) => Math.max(1, page - 1))}
                onNext={() =>
                  setDebtorPage((page) => Math.min(debtorPageCount, page + 1))
                }
              />
            </div>

            <div className="debtor-side-stack">
              <div className="report-panel">
                <h2>Collect debt</h2>
                {selectedDebtor ? (
                  <>
                    <div className="selected-account">
                      <span>Account</span>
                      <strong>{selectedDebtor.name}</strong>
                      <span>Amount owed</span>
                      <b>{formatMoney(selectedDebtorAmountOwed)}</b>
                      <span>Credit limit</span>
                      <b>{formatMoney(selectedDebtor.creditLimit)}</b>
                      <span>Available credit</span>
                      <b>
                        {formatMoney(
                          Math.max(selectedDebtor.creditLimit - selectedDebtorAmountOwed, 0),
                        )}
                      </b>
                    </div>

                    <div className="stack-form">
                      {selectedDebtorAmountOwed > 0 ? (
                        <>
                          <strong className="form-section-title">
                            Receive payment from {selectedDebtor.name}
                          </strong>
                          <label>
                            Amount collected
                            <input
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={debtCollectionAmount}
                              onChange={(event) =>
                                setDebtCollectionAmount(digitsOnly(event.target.value))
                              }
                              placeholder="0"
                            />
                          </label>
                          <label>
                            Method
                            <select
                              value={debtCollectionMethod}
                              onChange={(event) =>
                                setDebtCollectionMethod(
                                  event.target.value as DebtTransaction['paymentMethod'],
                                )
                              }
                            >
                              <option value="cash">Cash</option>
                              <option value="mtn-momo">MTN MoMo</option>
                              <option value="airtel-money">Airtel Money</option>
                              <option value="card">Card</option>
                            </select>
                          </label>
                          <label>
                            Reference
                            <input
                              value={debtCollectionReference}
                              onChange={(event) =>
                                setDebtCollectionReference(event.target.value)
                              }
                              placeholder="Receipt, MoMo ID, note"
                            />
                          </label>
                          <button className="primary-action" type="button" onClick={collectDebt}>
                            <HandCoins size={18} />
                            Record collection
                          </button>
                        </>
                      ) : (
                        <div className="empty-state compact-empty">
                          No debt to collect from this account.
                        </div>
                      )}

                      <details className="action-disclosure">
                        <summary>Add debt to this account</summary>
                        <div className="stack-form">
                          <label>
                            Amount owed
                            <input
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={debtChargeAmount}
                              onChange={(event) =>
                                setDebtChargeAmount(digitsOnly(event.target.value))
                              }
                              placeholder="0"
                            />
                          </label>
                          <label>
                            Reference
                            <input
                              value={debtChargeReference}
                              onChange={(event) => setDebtChargeReference(event.target.value)}
                              placeholder="Opening balance, invoice, note"
                            />
                          </label>
                          <button
                            className="secondary-action"
                            type="button"
                            onClick={recordDebtCharge}
                          >
                            <Plus size={18} />
                            Add debt
                          </button>
                        </div>
                      </details>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">Add or select a debtor first.</div>
                )}
              </div>

              <div className="report-panel">
                <h2>Add debtor</h2>
                <form className="stack-form" onSubmit={addDebtor}>
                  <label>
                    Name
                    <input
                      value={newDebtorName}
                      onChange={(event) => setNewDebtorName(event.target.value)}
                    />
                  </label>
                  <label>
                    Phone
                    <input
                      inputMode="tel"
                      value={newDebtorPhone}
                      onChange={(event) => setNewDebtorPhone(event.target.value)}
                    />
                  </label>
                  <label>
                    Credit limit
                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={newDebtorLimit}
                      onChange={(event) => setNewDebtorLimit(digitsOnly(event.target.value))}
                    />
                  </label>
                  <label>
                    Opening debt
                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={newDebtorOpeningDebt}
                      onChange={(event) =>
                        setNewDebtorOpeningDebt(digitsOnly(event.target.value))
                      }
                    />
                  </label>
                  <button className="secondary-action" type="submit">
                    <Plus size={18} />
                    Add debtor
                  </button>
                </form>
              </div>
            </div>

            <div className="report-panel span-two">
              <div className="panel-heading">
                <div>
                  <h2>Debt activity</h2>
                  <small>
                    Showing {debtActivityShowingFrom}-{debtActivityShowingTo} of{' '}
                    {data.debtTransactions.length} records.
                  </small>
                </div>
              </div>
              {pagedDebtTransactions.length === 0 ? (
                <div className="empty-state">No debt transactions yet.</div>
              ) : (
                <>
                  {pagedDebtTransactions.map((transaction) => (
                    <div className="debt-activity-row" key={transaction.id}>
                      <span>
                        <strong>{transaction.debtorName}</strong>
                        <small>
                          {transaction.type === 'payment'
                            ? 'Payment collected'
                            : transaction.type === 'charge'
                              ? 'Credit sale'
                              : 'Debt added'}{' '}
                          / {transaction.reference}
                        </small>
                      </span>
                      <b className={transaction.type === 'payment' ? 'success-text' : ''}>
                        {transaction.type === 'payment' ? '-' : '+'}
                        {formatMoney(transaction.amount)}
                      </b>
                      <small>{formatDateTime(transaction.createdAt)}</small>
                    </div>
                  ))}

                  <PaginationControls
                    label="Debt activity"
                    page={safeDebtActivityPage}
                    pageCount={debtActivityPageCount}
                    onPrevious={() =>
                      setDebtActivityPage((page) => Math.max(1, page - 1))
                    }
                    onNext={() =>
                      setDebtActivityPage((page) =>
                        Math.min(debtActivityPageCount, page + 1),
                      )
                    }
                  />
                </>
              )}
            </div>
          </section>
        )}

        {activeTab === 'shifts' && (
          <section className="screen shifts-grid">
            <div className="report-panel">
              <h2>Cash reconciliation</h2>
              <div className="stack-form">
                <Metric title="Opening float" value={formatMoney(openShift?.openingFloat ?? 0)} />
                <Metric title="Expected cash" value={formatMoney(cashExpected)} />
                <NumberInput
                  label="Counted cash"
                  value={countedCash}
                  onChange={setCountedCash}
                />
                <div className="button-row">
                  <button className="primary-action" type="button" onClick={openNewShift}>
                    Open shift
                  </button>
                  <button className="secondary-action" type="button" onClick={closeShift}>
                    Close shift
                  </button>
                </div>
              </div>
            </div>

            <div className="report-panel">
              <h2>Shift history</h2>
              {data.shifts.map((shift) => (
                <div className="compact-row" key={shift.id}>
                  <span>
                    {shift.cashierName}
                    <small>{formatDateTime(shift.openedAt)}</small>
                  </span>
                  <b>{shift.status}</b>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'reports' && (
          <section className="screen report-grid">
            <Metric title="Sales" value={formatMoney(todaysSales)} />
            <Metric title="Gross profit" value={formatMoney(todaysProfit)} />
            <Metric title="Stock at cost" value={formatMoney(stockValue)} />
            <Metric title="Low stock" value={String(lowStockProducts.length)} />

            <div className="report-panel span-two">
              <h2>Export reports</h2>
              <div className="export-grid">
                {(sessionUser?.role === 'owner' || sessionUser?.role === 'manager') && (
                  <>
                    <button className="secondary-action" type="button" onClick={exportSalesReport}>
                      <DatabaseBackup size={18} />
                      Sales CSV
                    </button>
                    <button className="secondary-action" type="button" onClick={exportShiftReport}>
                      <DatabaseBackup size={18} />
                      Shift CSV
                    </button>
                    <button className="secondary-action" type="button" onClick={exportDebtorsReport}>
                      <DatabaseBackup size={18} />
                      Debtors CSV
                    </button>
                    <button className="secondary-action" type="button" onClick={exportDebtCollectionsReport}>
                      <DatabaseBackup size={18} />
                      Debt activity CSV
                    </button>
                    <button className="secondary-action" type="button" onClick={exportEfrisReport}>
                      <DatabaseBackup size={18} />
                      EFRIS CSV
                    </button>
                  </>
                )}
                {(sessionUser?.role === 'owner' ||
                  sessionUser?.role === 'manager' ||
                  sessionUser?.role === 'stock-admin') && (
                  <>
                    <button className="secondary-action" type="button" onClick={exportProductsReport}>
                      <DatabaseBackup size={18} />
                      Product CSV
                    </button>
                    <button className="secondary-action" type="button" onClick={exportStockMovementsReport}>
                      <DatabaseBackup size={18} />
                      Stock movement CSV
                    </button>
                    <button className="secondary-action" type="button" onClick={exportPurchaseOrdersReport}>
                      <DatabaseBackup size={18} />
                      Purchase orders CSV
                    </button>
                    <button className="secondary-action" type="button" onClick={exportLowStockExpiryReport}>
                      <DatabaseBackup size={18} />
                      Low stock / expiry CSV
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="report-panel span-two">
              <h2>Low stock</h2>
              {lowStockProducts.length === 0 ? (
                <div className="empty-state">All products are above minimum stock.</div>
              ) : (
                lowStockProducts.map((product) => (
                  <div className="compact-row" key={product.id}>
                    <span>{product.name}</span>
                    <b>
                      {product.stockOnHand} / {product.minStock}
                    </b>
                  </div>
                ))
              )}
            </div>

            <div className="report-panel span-two">
              <h2>Recent receipts</h2>
              {data.sales.length === 0 ? (
                <div className="empty-state">No completed sales yet.</div>
              ) : (
                data.sales.slice(0, 8).map((sale) => (
                  <button
                    type="button"
                    className="receipt-row"
                    key={sale.id}
                    onClick={() => {
                      setLastSale(sale)
                      setActiveTab('checkout')
                    }}
                  >
                    <span>{sale.receiptNo}</span>
                    <small>{formatDateTime(sale.createdAt)}</small>
                    <b>{formatMoney(sale.total)}</b>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {activeTab === 'notifications' && (
          <section className="screen notifications-grid">
            <div className="report-panel span-two">
              <h2>Notifications</h2>
              {notifications.length === 0 ? (
                <div className="empty-state">No notifications right now.</div>
              ) : (
                notifications.map((notification) => (
                  <button
                    className={`notification-row ${notification.severity}`}
                    key={notification.id}
                    type="button"
                    onClick={() => {
                      if (allowedTabs.includes(notification.actionTab)) {
                        goToTab(notification.actionTab)
                        return
                      }

                      setStatus('Ask a manager or owner to handle this notification.')
                    }}
                  >
                    <span className="notification-marker" aria-hidden="true" />
                    <div className="notification-copy">
                      <div className="notification-heading">
                        <span className="notification-chip">{notification.category}</span>
                        <strong>{notification.title}</strong>
                      </div>
                      <small>{notification.detail}</small>
                    </div>
                    <span className="notification-action">
                      {allowedTabs.includes(notification.actionTab)
                        ? notification.actionLabel
                        : 'Manager required'}
                      <ChevronRight size={16} />
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="report-panel">
              <h2>Alert sources</h2>
              <div className="check-list">
                <span>Low stock</span>
                <b>{lowStockProducts.length}</b>
                <span>EFRIS queued</span>
                <b>
                  {
                    data.efrisTransactions.filter(
                      (transaction) => transaction.status === 'queued',
                    ).length
                  }
                </b>
                <span>Open shifts</span>
                <b>{allOpenShifts.length}</b>
                <span>Failed fiscal records</span>
                <b>
                  {
                    data.efrisTransactions.filter(
                      (transaction) => transaction.status === 'failed',
                    ).length
                  }
                </b>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'monitoring' && (
          <section className="screen monitoring-grid">
            <div className="report-panel span-two">
              <h2>Cashier monitoring</h2>
              <div className="monitor-table">
                <div className="monitor-head">
                  <span>Cashier</span>
                  <span>Shift</span>
                  <span>Receipts</span>
                  <span>Sales</span>
                  <span>Discounts</span>
                  <span>Returns</span>
                  <span>Last activity</span>
                </div>
                {cashierStats.map((stat) => (
                  <div className="monitor-row" key={stat.userId}>
                    <strong>{stat.name}</strong>
                    <span>{stat.openShift ? 'Open' : 'Closed'}</span>
                    <b>{stat.receipts}</b>
                    <b>{formatMoney(stat.sales)}</b>
                    <span>{formatMoney(stat.discounts)}</span>
                    <span>{stat.returns}</span>
                    <small>{stat.lastActivity ? formatDateTime(stat.lastActivity) : 'None'}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="report-panel">
              <h2>Monitoring rules</h2>
              <div className="check-list">
                <span>Every sale stores cashier</span>
                <b>Yes</b>
                <span>Every return stores cashier</span>
                <b>Yes</b>
                <span>Shift cash variance</span>
                <b>Tracked</b>
                <span>Discounts per cashier</span>
                <b>Tracked</b>
              </div>
            </div>

            <div className="report-panel span-two">
              <div className="panel-heading">
                <div>
                  <h2>Recent staff activity</h2>
                  <small>
                    Showing {activityShowingFrom}-{activityShowingTo} of{' '}
                    {filteredActivityLogs.length} matching audit entries.
                  </small>
                </div>
                <label>
                  Role filter
                  <select
                    value={activityRoleFilter}
                    onChange={(event) => {
                      setActivityRoleFilter(event.target.value as UserRole | 'all')
                      setActivityPage(1)
                    }}
                  >
                    <option value="all">All roles</option>
                    <option value="owner">Owner / super admin</option>
                    <option value="manager">Manager</option>
                    <option value="stock-admin">Stock administrator</option>
                    <option value="cashier">Cashier</option>
                  </select>
                </label>
              </div>

              {pagedActivityLogs.length === 0 ? (
                <div className="empty-state">No staff activity matches this filter.</div>
              ) : (
                <>
                  {pagedActivityLogs.map((log) => (
                    <div className="audit-row" key={log.id}>
                      <span>{log.userName}</span>
                      <b>{log.action}</b>
                      <small>{log.details}</small>
                      <small>{formatDateTime(log.createdAt)}</small>
                    </div>
                  ))}

                  <PaginationControls
                    label="Staff activity"
                    page={safeActivityPage}
                    pageCount={activityPageCount}
                    onPrevious={() => setActivityPage((page) => Math.max(1, page - 1))}
                    onNext={() =>
                      setActivityPage((page) => Math.min(activityPageCount, page + 1))
                    }
                  />
                </>
              )}
            </div>
          </section>
        )}

        {activeTab === 'efris' && (
          <section className="screen efris-grid">
            <div className="report-panel span-two">
              <h2>EFRIS queue</h2>
              {data.efrisTransactions.length === 0 ? (
                <div className="empty-state">No fiscal transactions queued.</div>
              ) : (
                data.efrisTransactions.map((transaction) => (
                  <div className="queue-row" key={transaction.id}>
                    <div>
                      <strong>{transaction.referenceNo}</strong>
                      <small>
                        {transaction.type} / {transaction.status}
                      </small>
                    </div>
                    <b>{transaction.fiscalDocumentNumber ?? 'Pending FDN'}</b>
                    <button className="secondary-action" type="button" onClick={() => submitEfris(transaction.id)}>
                      Retry / submit
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="report-panel">
              <h2>Fiscal readiness</h2>
              <div className="check-list">
                <span>Commodity codes stored</span>
                <b>Yes</b>
                <span>Fiscal document number field</span>
                <b>Yes</b>
                <span>Credit-note queue</span>
                <b>Yes</b>
                <span>Retry counter</span>
                <b>Yes</b>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'admin' && (
          <section className="screen admin-grid">
            <div className="report-panel">
              <h2>Users and roles</h2>
              <form className="stack-form" onSubmit={addUser}>
                <label>
                  Staff name
                  <input
                    value={newUserName}
                    onChange={(event) => setNewUserName(event.target.value)}
                  />
                </label>
                <label>
                  Staff number
                  <div className="input-action-row">
                    <input
                      autoComplete="off"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={newUserStaffNumber}
                      onChange={(event) => setNewUserStaffNumber(digitsOnly(event.target.value))}
                    />
                    <button className="secondary-action icon-action" type="button" onClick={generateStaffNumber} title="Generate unique staff number">
                      <RefreshCw size={18} />
                    </button>
                  </div>
                </label>
                <label>
                  Staff PIN
                  <input
                    autoComplete="new-password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={newUserPin}
                    onChange={(event) => setNewUserPin(digitsOnly(event.target.value))}
                  />
                </label>
                <label>
                  Role
                  <select
                    value={newUserRole}
                    onChange={(event) => setNewUserRole(event.target.value as UserRole)}
                  >
                    <option value="owner">Owner</option>
                    <option value="manager">Manager</option>
                    <option value="stock-admin">Stock administrator</option>
                    <option value="cashier">Cashier</option>
                  </select>
                </label>
                <button className="primary-action" type="submit">
                  <Users size={18} />
                  Add user
                </button>
              </form>

              <div className="mini-list loose">
                {data.users.map((user) => (
                  <div key={user.id}>
                    <span>
                      {user.staffNumber} - {user.name}
                    </span>
                    <b>{user.role}</b>
                  </div>
                ))}
              </div>
            </div>

            <div className="report-panel">
              <h2>Backups</h2>
              <div className="check-list">
                <span>Persistence</span>
                <b>{storageMode === 'database' ? databaseLabel : 'Browser fallback'}</b>
                <span>Save status</span>
                <b>{storageStatus}</b>
                <span>Last saved</span>
                <b>{lastSavedAt ? formatDateTime(lastSavedAt) : 'Not saved yet'}</b>
              </div>
              <div className="button-column">
                <button className="primary-action" type="button" onClick={backupData}>
                  <DatabaseBackup size={18} />
                  Download backup
                </button>
                <label className="file-action">
                  <ArchiveRestore size={18} />
                  Restore backup
                  <input type="file" accept="application/json" onChange={restoreData} />
                </label>
                <button className="secondary-action" type="button" onClick={resetDemoData}>
                  Reset demo data
                </button>
              </div>
            </div>

            <div className="report-panel span-two">
              <div className="panel-heading">
                <div>
                  <h2>Audit log</h2>
                  <small>
                    Showing {auditShowingFrom}-{auditShowingTo} of {data.auditLogs.length}{' '}
                    entries.
                  </small>
                </div>
                <div className="panel-actions">
                  <button className="secondary-action" type="button" onClick={exportAuditLog}>
                    <DatabaseBackup size={18} />
                    Audit CSV
                  </button>
                  <PaginationControls
                    compact
                    label="Audit log"
                    page={safeAuditPage}
                    pageCount={auditPageCount}
                    onPrevious={() => setAuditPage((page) => Math.max(1, page - 1))}
                    onNext={() => setAuditPage((page) => Math.min(auditPageCount, page + 1))}
                  />
                </div>
              </div>

              {pagedAuditLogs.length === 0 ? (
                <div className="empty-state">No audit entries yet.</div>
              ) : (
                pagedAuditLogs.map((log) => (
                  <div className="audit-row" key={log.id}>
                    <span>{log.action}</span>
                    <b>{log.entity}</b>
                    <small>{log.details}</small>
                    <small>{formatDateTime(log.createdAt)}</small>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        <div className="print-zone">
          {printMode === 'receipt' && lastSale && <PrintableReceipt sale={lastSale} />}
          {printMode === 'label' && labelProduct && <PrintableLabel product={labelProduct} />}
        </div>
      </section>
    </main>
  )
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={active ? 'active' : ''}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function LoginScreen({
  loginPin,
  onPinChange,
  onStaffNumberChange,
  onSubmit,
  loginStaffNumber,
  status,
  users,
}: {
  loginPin: string
  loginStaffNumber: string
  onPinChange: (value: string) => void
  onStaffNumberChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  status: string
  users: User[]
}) {
  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-lockup dark">
          <img className="brand-mark" src="/buvo-logo.svg" alt="BUVO" />
          <div>
            <strong>BUVO POS</strong>
            <span>Staff login</span>
          </div>
        </div>

        <form className="stack-form" onSubmit={onSubmit}>
          <label>
            Staff number
            <input
              autoFocus
              autoComplete="username"
              inputMode="numeric"
              pattern="[0-9]*"
              value={loginStaffNumber}
              onChange={(event) => onStaffNumberChange(digitsOnly(event.target.value))}
              placeholder="Enter staff number"
            />
          </label>
          <label>
            PIN
            <input
              autoComplete="current-password"
              inputMode="numeric"
              pattern="[0-9]*"
              type="password"
              value={loginPin}
              onChange={(event) => onPinChange(digitsOnly(event.target.value))}
              placeholder="Enter staff PIN"
            />
          </label>
          <button className="primary-action" type="submit">
            <UserCheck size={18} />
            Login
          </button>
        </form>

        <div className="demo-pins">
          <strong>Demo staff logins</strong>
          {users
            .filter((user) => user.active)
            .map((user) => (
              <span key={user.id}>
                {user.pin
                  ? `${user.staffNumber} / ${user.pin} - ${user.name}`
                  : `${user.staffNumber} - ${user.name}`}
              </span>
            ))}
        </div>

        <div className="status-pill">
          <WifiOff size={18} />
          <span>{status}</span>
        </div>
      </section>
    </main>
  )
}

function LockScreen({
  onLogout,
  onPinChange,
  onSubmit,
  pin,
  status,
  user,
}: {
  onLogout: () => void
  onPinChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  pin: string
  status: string
  user: User
}) {
  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-lockup dark">
          <img className="brand-mark" src="/buvo-logo.svg" alt="BUVO" />
          <div>
            <strong>BUVO POS</strong>
            <span>Session locked</span>
          </div>
        </div>

        <div className="locked-user">
          <span>Locked user</span>
          <strong>{user.name}</strong>
          <small>
            {user.staffNumber} / {roleLabels[user.role]}
          </small>
        </div>

        <form className="stack-form" onSubmit={onSubmit}>
          <label>
            Unlock PIN
            <input
              autoFocus
              autoComplete="current-password"
              inputMode="numeric"
              pattern="[0-9]*"
              type="password"
              value={pin}
              onChange={(event) => onPinChange(digitsOnly(event.target.value))}
              placeholder="Enter PIN to unlock"
            />
          </label>
          <button className="primary-action" type="submit">
            <UserCheck size={18} />
            Unlock
          </button>
          <button className="secondary-action" type="button" onClick={onLogout}>
            <LogOut size={18} />
            Switch user
          </button>
        </form>

        <div className="status-pill">
          <WifiOff size={18} />
          <span>{status}</span>
        </div>
      </section>
    </main>
  )
}

function TotalsPanel({
  discount,
  subtotal,
  tax,
  total,
}: {
  discount: number
  subtotal: number
  tax: number
  total: number
}) {
  return (
    <div className="totals-list">
      <div>
        <span>Subtotal</span>
        <strong>{formatMoney(subtotal)}</strong>
      </div>
      <div>
        <span>Discount</span>
        <strong>{formatMoney(discount)}</strong>
      </div>
      <div>
        <span>VAT estimate</span>
        <strong>{formatMoney(tax)}</strong>
      </div>
      <div className="grand-total">
        <span>Total</span>
        <strong>{formatMoney(total)}</strong>
      </div>
    </div>
  )
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="metric-tile">
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  )
}

function MovementFeed({ movements }: { movements: StockMovement[] }) {
  return (
    <aside className="movement-feed">
      <h2>Stock movements</h2>
      {movements.map((movement) => (
        <div className="movement-row" key={movement.id}>
          <div>
            <strong>{movement.productName}</strong>
            <span>{movement.reference}</span>
          </div>
          <b className={movement.quantity < 0 ? 'danger' : ''}>
            {movement.quantity > 0 ? '+' : ''}
            {movement.quantity}
          </b>
        </div>
      ))}
    </aside>
  )
}

function ReceiptPreview({ sale }: { sale: Sale }) {
  return (
    <div className="receipt-preview">
      <div className="receipt-title">
        <strong>BUVO Market</strong>
        <span>{sale.receiptNo}</span>
      </div>
      <small>{formatDateTime(sale.createdAt)}</small>

      {sale.items.map((item) => (
        <div className="receipt-line" key={`${sale.id}-${item.productId}`}>
          <span>
            {item.quantity} x {item.name}
          </span>
          <b>
            {formatMoney(
              item.unitPrice * item.quantity * (1 - item.discountPercent / 100),
            )}
          </b>
        </div>
      ))}

      <div className="receipt-total">
        <span>Total</span>
        <strong>{formatMoney(sale.total)}</strong>
      </div>
      <small>TIN: pending</small>
      <small>FDN: {sale.fiscalDocumentNumber ?? 'pending'}</small>
    </div>
  )
}

function PrintableReceipt({ sale }: { sale: Sale }) {
  return (
    <section className="print-receipt">
      <header className="print-brand">
        <img src="/buvo-logo.svg" alt="BUVO" />
        <h2>BUVO Market</h2>
        <p>Better Value, Every Day.</p>
      </header>
      <div className="print-meta">
        <span>Branch</span>
        <b>{sale.branchId}</b>
        <span>Receipt</span>
        <b>{sale.receiptNo}</b>
        <span>Date</span>
        <b>{formatDateTime(sale.createdAt)}</b>
        <span>Cashier</span>
        <b>{sale.cashierName}</b>
      </div>
      {sale.items.map((item) => (
        <div className="print-line" key={`${sale.id}-print-${item.productId}`}>
          <span>
            {item.quantity} x {item.name}
          </span>
          <b>
            {formatMoney(
              item.unitPrice * item.quantity * (1 - item.discountPercent / 100),
            )}
          </b>
        </div>
      ))}
      <div className="print-line">
        <span>VAT</span>
        <b>{formatMoney(sale.tax)}</b>
      </div>
      <div className="print-line total">
        <span>Total</span>
        <b>{formatMoney(sale.total)}</b>
      </div>
      <div className="print-meta">
        <span>TIN</span>
        <b>pending</b>
        <span>FDN</span>
        <b>{sale.fiscalDocumentNumber ?? 'pending'}</b>
      </div>
      <footer className="print-footer">
        <p>Thank you for shopping with BUVO.</p>
        <small>Keep this receipt for returns and EFRIS verification.</small>
      </footer>
    </section>
  )
}

function PrintableLabel({ product }: { product: Product }) {
  return (
    <section className="print-label">
      <strong>{product.name}</strong>
      <span>{formatMoney(product.unitPrice)}</span>
      <code>{product.internalBarcode ?? product.barcodes[0]}</code>
    </section>
  )
}

function PaginationControls({
  compact = false,
  label,
  onNext,
  onPrevious,
  page,
  pageCount,
}: {
  compact?: boolean
  label: string
  onNext: () => void
  onPrevious: () => void
  page: number
  pageCount: number
}) {
  return (
    <div className={compact ? 'pagination compact' : 'pagination'} aria-label={`${label} pagination`}>
      <button
        className="secondary-action icon-action"
        type="button"
        onClick={onPrevious}
        disabled={page <= 1}
        title={`Previous ${label.toLowerCase()} page`}
      >
        <ChevronLeft size={18} />
      </button>
      <span>
        {page} / {pageCount}
      </span>
      <button
        className="secondary-action icon-action"
        type="button"
        onClick={onNext}
        disabled={page >= pageCount}
        title={`Next ${label.toLowerCase()} page`}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  )
}

function NumberInput({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label>
      {label}
      <input
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function DataListInput({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: string) => void
  options: string[]
  value: string
}) {
  const listId = `${label.toLowerCase().replace(/\s+/g, '-')}-list`

  return (
    <label>
      {label}
      <input list={listId} value={value} onChange={(event) => onChange(event.target.value)} />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </label>
  )
}

function CustomerDisplay() {
  const [payload, setPayload] = useState<CustomerDisplayPayload>(readCustomerDisplayPayload)

  useEffect(() => {
    const channel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL)
    const handleStorage = (event: StorageEvent) => {
      if (event.key === CUSTOMER_DISPLAY_KEY) {
        setPayload(readCustomerDisplayPayload())
      }
    }

    channel.onmessage = (event: MessageEvent<CustomerDisplayPayload>) => {
      setPayload(event.data)
    }
    window.addEventListener('storage', handleStorage)

    return () => {
      channel.close()
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const headline =
    payload.status === 'paid'
      ? 'Thank you for shopping with BUVO'
      : payload.status === 'active'
        ? 'Your basket'
        : 'Welcome to BUVO'

  return (
    <main className="customer-display-shell">
      <header className="customer-display-header">
        <div className="brand-lockup">
          <img className="brand-mark" src="/buvo-logo.svg" alt="BUVO" />
          <div>
            <strong>BUVO POS</strong>
            <span>{payload.branchName}</span>
          </div>
        </div>
        <div>
          <span>{payload.cashierName ? `Served by ${payload.cashierName}` : 'Counter ready'}</span>
          <b>{formatDateTime(payload.updatedAt)}</b>
        </div>
      </header>

      <section className="customer-display-total">
        <span>{headline}</span>
        <strong>{formatMoney(payload.total)}</strong>
        {payload.receiptNo && <b>{payload.receiptNo}</b>}
      </section>

      <section className="customer-display-grid">
        <div className="customer-items-panel">
          <div className="customer-panel-title">
            <span>Items</span>
            <b>{payload.lines.length}</b>
          </div>
          {payload.lines.length === 0 ? (
            <div className="customer-empty">Items will appear here as they are scanned.</div>
          ) : (
            <div className="customer-item-list">
              {payload.lines.map((line) => (
                <div className="customer-item-row" key={line.id}>
                  <div>
                    <strong>{line.name}</strong>
                    <span>
                      {line.quantity} x {formatMoney(line.unitPrice)}
                      {line.discountPercent > 0
                        ? ` / ${line.discountPercent}% discount`
                        : ''}
                    </span>
                  </div>
                  <b>{formatMoney(line.lineTotal)}</b>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="customer-summary-panel">
          {payload.lastItem ? (
            <div className="customer-last-item">
              <span>Last scanned</span>
              <strong>{payload.lastItem.name}</strong>
              <b>{formatMoney(payload.lastItem.unitPrice)}</b>
            </div>
          ) : (
            <div className="customer-last-item muted">
              <span>Last scanned</span>
              <strong>Waiting for item</strong>
            </div>
          )}

          <div className="customer-total-lines">
            <div>
              <span>Subtotal</span>
              <b>{formatMoney(payload.subtotal)}</b>
            </div>
            <div>
              <span>Discount</span>
              <b>{formatMoney(payload.discount)}</b>
            </div>
            <div>
              <span>VAT</span>
              <b>{formatMoney(payload.tax)}</b>
            </div>
            <div className="customer-due-line">
              <span>{payload.status === 'paid' ? 'Paid' : 'Amount due'}</span>
              <b>
                {payload.status === 'paid'
                  ? formatMoney(payload.paid)
                  : formatMoney(payload.amountDue)}
              </b>
            </div>
            {payload.change > 0 && (
              <div className="customer-change-line">
                <span>Change</span>
                <b>{formatMoney(payload.change)}</b>
              </div>
            )}
          </div>

          <p>{payload.paymentSummary}</p>
        </aside>
      </section>
    </main>
  )
}

function getTitle(tab: Tab) {
  const titles: Record<Tab, string> = {
    checkout: 'Checkout',
    receiving: 'Stock receiving',
    products: 'Products',
    inventory: 'Inventory',
    returns: 'Returns',
    debtors: 'Debtors',
    shifts: 'Shifts',
    reports: 'Daily reports',
    notifications: 'Notifications',
    monitoring: 'Cashier monitoring',
    efris: 'EFRIS',
    admin: 'Admin',
  }

  return titles[tab]
}

function getAllowedTabs(role: UserRole): Tab[] {
  const shared: Tab[] = ['notifications']

  if (role === 'owner' || role === 'manager') {
    const managerTabs: Tab[] = [
      'checkout',
      'receiving',
      'products',
      'inventory',
      'returns',
      'debtors',
      'shifts',
      'reports',
      'notifications',
      'monitoring',
      'efris',
    ]

    return role === 'owner' ? [...managerTabs, 'admin'] : managerTabs
  }

  if (role === 'stock-admin') {
    return ['receiving', 'products', 'inventory', 'reports', ...shared]
  }

  return ['checkout', 'products', 'returns', 'debtors', 'shifts', ...shared]
}

function getDefaultTab(role: UserRole): Tab {
  if (role === 'stock-admin') {
    return 'receiving'
  }

  return 'checkout'
}

function getNotifications(data: AppData): Notification[] {
  const now = Date.now()
  const soon = 1000 * 60 * 60 * 24 * 30
  const lowStock = data.products
    .filter((product) => product.stockOnHand <= product.minStock)
    .map((product) => ({
      id: `low-${product.id}`,
      severity: 'warning' as const,
      category: 'Stock',
      title: `${product.name} is low`,
      detail: `${product.stockOnHand} in stock; minimum is ${product.minStock}.`,
      actionTab: 'products' as const,
      actionLabel: 'Open products',
    }))
  const expiring = data.products
    .filter((product) => {
      if (!product.expiryDate) {
        return false
      }

      return new Date(product.expiryDate).getTime() - now <= soon
    })
    .map((product) => ({
      id: `exp-${product.id}`,
      severity: 'danger' as const,
      category: 'Expiry',
      title: `${product.name} expires soon`,
      detail: product.expiryDate ? `Expiry date: ${product.expiryDate}.` : '',
      actionTab: 'inventory' as const,
      actionLabel: 'Open inventory',
    }))
  const fiscal = data.efrisTransactions
    .filter((transaction) => transaction.status === 'queued' || transaction.status === 'failed')
    .map((transaction) => ({
      id: `efris-${transaction.id}`,
      severity: transaction.status === 'failed' ? ('danger' as const) : ('info' as const),
      category: 'EFRIS',
      title: `${transaction.referenceNo} needs EFRIS attention`,
      detail: `${sentenceCase(transaction.type)} is ${transaction.status}.`,
      actionTab: 'efris' as const,
      actionLabel: 'Open EFRIS',
    }))
  const shiftWarnings = data.shifts
    .filter((shift) => shift.status === 'open')
    .map((shift) => ({
      id: `shift-${shift.id}`,
      severity: 'info' as const,
      category: 'Shift',
      title: `${shift.cashierName} has an open shift`,
      detail: `Opened ${formatDateTime(shift.openedAt)}.`,
      actionTab: 'shifts' as const,
      actionLabel: 'Review shift',
    }))

  return [...expiring, ...lowStock, ...fiscal, ...shiftWarnings]
}

function getCashierStats(data: AppData) {
  return data.users
    .filter((user) => user.role === 'cashier' || user.role === 'manager')
    .map((user) => {
      const userSales = data.sales.filter((sale) => sale.cashierId === user.id)
      const completedSales = userSales.filter((sale) => sale.status === 'completed')
      const userReturns = data.returns.filter((record) => record.cashierId === user.id)
      const openShift = data.shifts.some(
        (shift) => shift.cashierId === user.id && shift.status === 'open',
      )
      const lastSale = userSales
        .map((sale) => sale.createdAt)
        .sort()
        .at(-1)

      return {
        userId: user.id,
        name: user.name,
        openShift,
        receipts: completedSales.length,
        sales: completedSales.reduce((sum, sale) => sum + sale.total, 0),
        discounts: completedSales.reduce((sum, sale) => sum + sale.discount, 0),
        returns: userReturns.length,
        lastActivity: lastSale,
      }
    })
}

function createMovement(
  user: User,
  productId: string,
  productName: string,
  quantity: number,
  reason: StockMovement['reason'],
  reference: string,
): StockMovement {
  return {
    id: createId('mov'),
    productId,
    productName,
    quantity,
    reason,
    createdAt: new Date().toISOString(),
    reference,
    userId: user.id,
    userName: user.name,
  }
}

function uniqueList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort()
}

function lineTotal(item: Sale['items'][number]) {
  return item.unitPrice * item.quantity * (1 - item.discountPercent / 100)
}

function toCustomerLine(item: Sale['items'][number]): CustomerDisplayLine {
  return {
    barcode: item.barcode,
    discountPercent: item.discountPercent,
    id: item.productId,
    lineTotal: lineTotal(item),
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }
}

function createCustomerDisplayPayload({
  cartItems,
  lastCustomerItem,
  lastSale,
  paidTotal,
  payments,
  saleTotals,
  sessionUser,
}: {
  cartItems: Sale['items']
  lastCustomerItem?: CustomerDisplayPayload['lastItem']
  lastSale: Sale | null
  paidTotal: number
  payments: Payment[]
  saleTotals: Pick<Sale, 'discount' | 'subtotal' | 'tax' | 'total'>
  sessionUser: User | null
}): CustomerDisplayPayload {
  const activeLines = cartItems.map(toCustomerLine)

  if (activeLines.length > 0) {
    return {
      amountDue: Math.max(saleTotals.total - paidTotal, 0),
      branchName: 'Kampala branch',
      cashierName: sessionUser?.name ?? '',
      change: Math.max(paidTotal - saleTotals.total, 0),
      discount: saleTotals.discount,
      lastItem: lastCustomerItem,
      lines: activeLines,
      paid: paidTotal,
      paymentSummary:
        payments.length > 0
          ? payments
              .map((payment) => `${paymentLabels[payment.method]} ${formatMoney(payment.amount)}`)
              .join(' / ')
          : 'Payment not recorded yet',
      status: 'active',
      subtotal: saleTotals.subtotal,
      tax: saleTotals.tax,
      total: saleTotals.total,
      updatedAt: new Date().toISOString(),
    }
  }

  if (lastSale) {
    const paid = lastSale.payments.reduce((sum, payment) => sum + payment.amount, 0)

    return {
      amountDue: 0,
      branchName: 'Kampala branch',
      cashierName: lastSale.cashierName,
      change: Math.max(paid - lastSale.total, 0),
      discount: lastSale.discount,
      lastItem: lastCustomerItem,
      lines: lastSale.items.map(toCustomerLine),
      paid,
      paymentSummary: lastSale.payments
        .map((payment) => `${paymentLabels[payment.method]} ${formatMoney(payment.amount)}`)
        .join(' / '),
      receiptNo: lastSale.receiptNo,
      status: 'paid',
      subtotal: lastSale.subtotal,
      tax: lastSale.tax,
      total: lastSale.total,
      updatedAt: lastSale.createdAt,
    }
  }

  return {
    ...emptyCustomerDisplay,
    cashierName: sessionUser?.name ?? '',
    lastItem: lastCustomerItem,
    updatedAt: new Date().toISOString(),
  }
}

function readCustomerDisplayPayload() {
  if (typeof window === 'undefined') {
    return emptyCustomerDisplay
  }

  try {
    const saved = window.localStorage.getItem(CUSTOMER_DISPLAY_KEY)

    return saved ? (JSON.parse(saved) as CustomerDisplayPayload) : emptyCustomerDisplay
  } catch {
    return emptyCustomerDisplay
  }
}

function getDebtorBalance(debtorId: string, transactions: DebtTransaction[]) {
  return transactions
    .filter((transaction) => transaction.debtorId === debtorId)
    .reduce((sum, transaction) => {
      if (transaction.type === 'payment') {
        return sum - transaction.amount
      }

      return sum + transaction.amount
    }, 0)
}

function getExpectedCash(
  openShift: CashierShift | undefined,
  sales: Sale[],
  debtTransactions: DebtTransaction[],
) {
  if (!openShift) {
    return 0
  }

  const cashSales = sales
    .filter((sale) => sale.shiftId === openShift.id && sale.status === 'completed')
    .flatMap((sale) => sale.payments)
    .filter((payment) => payment.method === 'cash')
    .reduce((sum, payment) => sum + payment.amount, 0)
  const cashDebtCollections = debtTransactions
    .filter(
      (transaction) =>
        transaction.type === 'payment' &&
        transaction.paymentMethod === 'cash' &&
        transaction.userId === openShift.cashierId &&
        transaction.createdAt >= openShift.openedAt,
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0)

  return openShift.openingFloat + cashSales + cashDebtCollections
}

const navItems: { tab: Tab; label: string; icon: ReactNode }[] = [
  { tab: 'checkout', label: 'Checkout', icon: <ShoppingBasket size={19} /> },
  { tab: 'receiving', label: 'Receiving', icon: <PackagePlus size={19} /> },
  { tab: 'products', label: 'Products', icon: <Boxes size={19} /> },
  { tab: 'inventory', label: 'Inventory', icon: <ClipboardList size={19} /> },
  { tab: 'returns', label: 'Returns', icon: <RotateCcw size={19} /> },
  { tab: 'debtors', label: 'Debtors', icon: <HandCoins size={19} /> },
  { tab: 'shifts', label: 'Shifts', icon: <Landmark size={19} /> },
  { tab: 'reports', label: 'Reports', icon: <LayoutDashboard size={19} /> },
  { tab: 'notifications', label: 'Notifications', icon: <Bell size={19} /> },
  { tab: 'monitoring', label: 'Monitor', icon: <UserCheck size={19} /> },
  { tab: 'efris', label: 'EFRIS', icon: <ShieldCheck size={19} /> },
  { tab: 'admin', label: 'Admin', icon: <Settings size={19} /> },
]

const roleLabels: Record<UserRole, string> = {
  owner: 'Owner / super admin',
  manager: 'Manager',
  'stock-admin': 'Stock administrator',
  cashier: 'Cashier',
}

const paymentOptions: { method: PaymentMethod; icon: ReactNode }[] = [
  { method: 'cash', icon: <Banknote size={18} /> },
  { method: 'mtn-momo', icon: <WalletCards size={18} /> },
  { method: 'airtel-money', icon: <WalletCards size={18} /> },
  { method: 'card', icon: <CreditCard size={18} /> },
  { method: 'split', icon: <FileClock size={18} /> },
  { method: 'credit', icon: <HandCoins size={18} /> },
]

export default App
