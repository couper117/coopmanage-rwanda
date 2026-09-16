import { AlertTriangle, ArrowRight, CheckCircle2, LayoutDashboard, PackageX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { formatMoney, formatQuantity } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import { Alert, Badge, Button, EmptyState, Panel, Skeleton, type BadgeTone } from '@/components/ui'
import {
  ExpensesByCategoryChart,
  IncomeExpenseChart,
  SalesTrendChart,
} from '@/features/dashboard/DashboardCharts'
import type {
  ActivityEntry,
  AttentionItem,
  DashboardTile,
  HealthRating,
  HealthSignal,
  LowStockRow,
} from '@/features/dashboard/dashboard.api'
import { useDashboard, useDashboardError } from '@/features/dashboard/dashboard.hooks'
import { sentenceParams } from '@/features/dashboard/sentence'
import { useLazyNamespaces } from '@/hooks/useLazyNamespaces'
import { AUDIT_MESSAGE_NAMESPACES } from '@/i18n'
import { toI18nKey, translateParams } from '@/lib/messageKey'

/**
 * Where the cooperative stands, now.
 *
 * The page is ordered by the question a manager is asked first, because the criterion for this
 * screen is that they can answer it within ten seconds of the page loading. So the health rating
 * comes first with the figures behind it **in words** — not a coloured dot a reader has to take on
 * trust — then what needs doing today, then the headline figures, then the charts, then what
 * anybody did recently.
 *
 * **One request fills all of it.** Every block is gated by the permission covering its own data,
 * and a block the reader may not see is *named* rather than dropped: a storekeeper's dashboard has
 * no money on it and says so, so nobody mistakes a missing tile for a cooperative with no money.
 */

const HEALTH_TONE: Readonly<Record<HealthRating, BadgeTone>> = {
  GOOD: 'success',
  WATCH: 'warning',
  ATTENTION: 'danger',
}

export function DashboardPage() {
  const { t } = useTranslation(['dashboard', 'common'])
  const describeError = useDashboardError()
  const dashboard = useDashboard()

  if (dashboard.isPending) {
    return (
      <div className="flex flex-col gap-5">
        {/*
          The real heading, not a grey box where a heading will be. A page whose figures are still
          coming is still this page, and a reader using a screen reader on a district-office
          connection should be told which page they are on rather than be handed a headingless
          document for a second and a half.
        */}
        <PageHeader title={t('dashboard:title')} description={t('dashboard:description')} />
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t('dashboard:title')} description={t('dashboard:description')} />
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" size="sm" onClick={() => void dashboard.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {describeError(dashboard.error).message}
        </Alert>
      </div>
    )
  }

  const board = dashboard.data

  // A cooperative on its first day genuinely has nothing to show, and this is how it says so —
  // not an error, and not a row of zeroes pretending to be figures.
  const nothingRecorded =
    board.tiles.every((tile) => Number(tile.value) === 0) && board.activity.length === 0

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('dashboard:title')}
        description={t('dashboard:forCooperative', { name: board.cooperative.name })}
      />

      {board.health.signals.length > 0 ? <HealthBanner health={board.health} /> : null}

      {board.attention.length > 0 ? <AttentionPanel items={board.attention} /> : null}

      {board.tiles.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {board.tiles.map((tile) => (
            <Tile key={tile.key} tile={tile} />
          ))}
        </div>
      ) : null}

      {nothingRecorded ? (
        <Panel>
          <EmptyState
            icon={LayoutDashboard}
            title={t('dashboard:empty.title')}
            description={t('dashboard:empty.body')}
          />
        </Panel>
      ) : (
        <>
          {board.charts.map((chart) => {
            if (chart.key === 'incomeExpense') {
              return <IncomeExpenseChart key={chart.key} chart={chart} />
            }
            if (chart.key === 'sales') return <SalesTrendChart key={chart.key} chart={chart} />
            return <ExpensesByCategoryChart key={chart.key} chart={chart} />
          })}

          {board.lowStock.length > 0 ? <LowStockPanel rows={board.lowStock} /> : null}

          {board.activity.length > 0 ? <ActivityPanel entries={board.activity} /> : null}
        </>
      )}

      {board.withheld.length > 0 ? (
        <p className="text-sm text-ink-muted">
          {t('dashboard:withheld', {
            sections: board.withheld
              .map((section) => t(`dashboard:sections.${section}`))
              .join(', '),
          })}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The cooperative's position, in one sentence per signal.
 *
 * The rating is a word, and beside it each signal names the figures it was judged on — because
 * "WATCH" alone is a verdict a manager has to trust rather than a fact they can check. A
 * cooperative that spent more than it earned this month while buying fertiliser before planting is
 * not in trouble, and the sentence saying which two figures were compared is what lets the reader
 * decide that for themselves.
 */
function HealthBanner({ health }: { health: { rating: HealthRating; signals: HealthSignal[] } }) {
  const { t } = useTranslation('dashboard')

  return (
    <Panel>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={HEALTH_TONE[health.rating]}>{t(`health.rating.${health.rating}`)}</Badge>
          <p className="text-base font-medium text-ink">{t(`health.headline.${health.rating}`)}</p>
        </div>
        <ul className="flex flex-col gap-1.5 text-sm text-ink-secondary">
          {health.signals.map((signal) => (
            <li key={signal.key} className="flex items-start gap-2">
              <SignalIcon rating={signal.rating} />
              {/*
                `health.money.WATCH`, and so on: the key names the signal and the rating together,
                so each combination gets a sentence written for it rather than one sentence with a
                word swapped into it. `sentenceParams` formats the money and makes `count` a number
                so the plural is chosen.
              */}
              <span>
                {t(`health.${signal.key}.${signal.rating}`, sentenceParams(signal.params))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

/** Shape as well as colour: a rating must not depend on being able to tell green from red. */
function SignalIcon({ rating }: { rating: HealthRating }) {
  if (rating === 'GOOD') {
    return <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success-fg" />
  }
  return (
    <AlertTriangle
      aria-hidden="true"
      className={
        rating === 'ATTENTION'
          ? 'mt-0.5 size-4 shrink-0 text-danger-fg'
          : 'mt-0.5 size-4 shrink-0 text-warning-fg'
      }
    />
  )
}

/** What needs doing, worst first, each line opening the screen where it is done. */
function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const { t } = useTranslation('dashboard')

  return (
    <Panel title={t('attention.title')} description={t('attention.description')}>
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-start justify-between gap-2">
            <span className="flex min-w-0 items-start gap-2 text-sm">
              <Badge tone={item.severity === 'CRITICAL' ? 'danger' : 'warning'}>
                {t(`attention.severity.${item.severity}`)}
              </Badge>
              <span className="text-ink">
                {t(`attention.item.${item.key}`, sentenceParams(item.params))}
              </span>
            </span>
            {item.href ? (
              <Button variant="ghost" size="sm" asChild>
                <Link to={item.href}>
                  {t('attention.go')}
                  <ArrowRight aria-hidden="true" className="ml-1 size-4" />
                </Link>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * A headline figure, and the second figure that gives it meaning.
 *
 * "1,240,000" alone invites the wrong conclusion in either direction; "1,240,000, of which 380,000
 * is still owed" is a figure a manager can act on. So a tile carries its own hint, and the whole
 * tile is a link, because a number nobody can get behind is half a number.
 */
function Tile({ tile }: { tile: DashboardTile }) {
  const { t } = useTranslation('dashboard')

  const render = (value: string, type: DashboardTile['type']): string =>
    type === 'money' ? formatMoney(value, { withCurrency: false }) : formatQuantity(value)

  const body = (
    <>
      <p className="text-sm text-ink-muted">{t(`tiles.${tile.key}`)}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
        {render(tile.value, tile.type)}
      </p>
      {tile.hint ? (
        <p className="mt-0.5 text-sm text-ink-muted">
          {t(`tiles.hint.${tile.hint.key}`, { value: render(tile.hint.value, tile.hint.type) })}
        </p>
      ) : null}
    </>
  )

  if (!tile.href) return <Panel>{body}</Panel>

  return (
    <Link
      to={tile.href}
      className="rounded-lg border border-line bg-surface p-4 transition-colors hover:border-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
    >
      {body}
    </Link>
  )
}

/**
 * The products at or below their minimum.
 *
 * Deliberately a list and not a chart. `docs/ui-system.md` §10 allows three charts and this is not
 * one of them, and the reason is the work: a storekeeper needs the name and how much is left, which
 * a bar cannot give them. A product at zero is called out separately from one merely running low,
 * because only one of the two stops the cooperative selling today.
 */
function LowStockPanel({ rows }: { rows: LowStockRow[] }) {
  const { t } = useTranslation('dashboard')

  return (
    <Panel flush title={t('lowStock.title')} description={t('lowStock.description')}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t('lowStock.caption')}</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="px-4 py-2 font-semibold">
                {t('lowStock.product')}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                {t('lowStock.left')}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                {t('lowStock.minimum')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2">
                  <span className="text-ink">{row.name}</span>
                  <span className="block text-xs text-ink-muted">{row.sku}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {Number(row.quantity) === 0 ? (
                    <span className="inline-flex items-center gap-1 text-danger-fg">
                      <PackageX aria-hidden="true" className="size-4" />
                      {t('lowStock.none')}
                    </span>
                  ) : (
                    formatQuantity(row.quantity, row.unit)
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                  {formatQuantity(row.minimum, row.unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/**
 * The last few things anybody did.
 *
 * Each line is composed from the entry's own key and parameters, exactly as the activity log
 * composes it, and a parameter that is itself a key — an enum the server sent rather than
 * translated — is resolved through `translateParams`, because `SAVINGS` in the middle of a
 * Kinyarwanda sentence is not a translation.
 *
 * Those sentences live in namespaces this screen does not otherwise need, and only a reader
 * holding `audit:view` has this block at all, so they are fetched **after** the page is on screen
 * rather than bundled into the first download. Until they arrive the panel shows a skeleton in its
 * own place: nothing above it waits, and no reader is ever shown a translation key.
 */
function ActivityPanel({ entries }: { entries: ActivityEntry[] }) {
  const { t, i18n } = useTranslation(['dashboard', ...AUDIT_MESSAGE_NAMESPACES])
  const ready = useLazyNamespaces(AUDIT_MESSAGE_NAMESPACES)

  /**
   * The person, without the address beside it.
   *
   * An audit entry records its actor as `Claudine Uwimana <uwimana.claudine@…>`, and that is
   * right for the trail: the label is a snapshot that must still identify the account years later,
   * after a rename or a departure. It is wrong for a glance — eight lines each carrying an email
   * address is eight lines nobody reads — so the activity list shows the name and the activity log
   * keeps the whole label.
   */
  const actor = (label: string): string => label.replace(/\s*<[^>]*>$/, '')

  const when = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language === 'rw' ? 'rw-RW' : 'en-RW', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))

  return (
    <Panel
      title={t('dashboard:activity.title')}
      actions={
        <Button variant="ghost" size="sm" asChild>
          <Link to="/settings/audit">
            {t('dashboard:activity.all')}
            <ArrowRight aria-hidden="true" className="ml-1 size-4" />
          </Link>
        </Button>
      }
    >
      {ready ? (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-0.5">
              <span className="text-sm text-ink">
                {t(toI18nKey(entry.messageKey), {
                  ...translateParams(entry.messageParams, (key) => t(key)),
                  // An entry written by a module whose strings this build does not carry still says
                  // something: the action, which is stable and readable, rather than a dotted key.
                  defaultValue: entry.action,
                })}
              </span>
              <span className="text-xs text-ink-muted">
                {actor(entry.actor)} · {when(entry.at)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div
          aria-label={t('dashboard:activity.loading')}
          aria-busy="true"
          className="flex flex-col gap-3"
        >
          {entries.map((entry) => (
            <Skeleton key={entry.id} className="h-8 w-full" />
          ))}
        </div>
      )}
    </Panel>
  )
}
