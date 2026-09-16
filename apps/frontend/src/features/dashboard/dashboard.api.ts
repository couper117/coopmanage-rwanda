import { apiRequest } from '@/lib/apiClient'

/**
 * The dashboard, as the interface sees it.
 *
 * **One request.** Every tile, chart, list and the health rating arrive together, because on the
 * connections this product is used over five requests is five chances to be slow and five spinners
 * finishing at different moments. Nothing here fetches a second time to fill a panel.
 *
 * Figures are decimal strings and the renderer formats them, exactly as the reports do. A tile
 * carries a `type` so the screen knows whether it is money, a quantity or a count, rather than the
 * screen having to know what each key means.
 */

export type TileType = 'money' | 'quantity' | 'number'

export interface DashboardTile {
  key: string
  type: TileType
  value: string
  hint?: { key: string; value: string; type: TileType }
  href?: string
}

export interface ChartPoint {
  /** `2026-09` for a month, or a category name for the expenses breakdown. */
  bucket: string
  values: Record<string, string>
}

export interface DashboardChart {
  key: 'incomeExpense' | 'sales' | 'expensesByCategory'
  series: string[]
  points: ChartPoint[]
}

export interface AttentionItem {
  key: string
  severity: 'WARNING' | 'CRITICAL'
  /** Values for the sentence the screen composes. The server never sends a finished sentence. */
  params: Record<string, string | number>
  href?: string
}

export interface ActivityEntry {
  id: string
  action: string
  actor: string
  messageKey: string
  messageParams: Record<string, unknown> | null
  at: string
}

export type HealthRating = 'GOOD' | 'WATCH' | 'ATTENTION'

export interface HealthSignal {
  key: 'money' | 'stock' | 'receivables'
  rating: HealthRating
  params: Record<string, string | number>
}

export interface LowStockRow {
  id: string
  name: string
  sku: string
  quantity: string
  minimum: string
  unit: string
}

export interface Dashboard {
  cooperative: { name: string; code: string }
  month: string
  tiles: DashboardTile[]
  charts: DashboardChart[]
  lowStock: LowStockRow[]
  attention: AttentionItem[]
  activity: ActivityEntry[]
  health: { rating: HealthRating; signals: HealthSignal[] }
  /** Sections this reader's role does not cover, so the screen says so rather than showing none. */
  withheld: string[]
}

export function fetchDashboard(): Promise<Dashboard> {
  return apiRequest<Dashboard>('/dashboard')
}

export const SEARCH_KINDS = ['member', 'product', 'buyer', 'sale', 'document', 'meeting'] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]

export interface SearchHit {
  kind: SearchKind
  id: string
  title: string
  subtitle: string | null
  href: string
  score: number
}

export interface SearchResults {
  query: string
  hits: SearchHit[]
  withheld: string[]
  truncated: boolean
}

export function searchEverything(q: string): Promise<SearchResults> {
  return apiRequest<SearchResults>('/search', { query: { q } })
}
