import { ArrowRight, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { formatMoney, formatQuantity } from '@coopmanage/shared'
import { Alert, Panel } from '@/components/ui'
import { internalPath } from '@/lib/internalPath'
import type { AssistantFigure } from './assistant.api'

/**
 * An answer: the sentence, the figures it rests on, and the screen that shows them in full.
 *
 * The figures are not decoration. They are how a cooperative checks the sentence without taking it
 * on trust — and the link is how it goes and looks. An assistant that answered "you sold 3,100,000
 * this month" and stopped there would be asking to be believed; this one shows the four figures the
 * query returned and points at the sales screen.
 */

/** The cooperative's own words, where a label is a category or product it named itself. */
const LITERAL = 'literal:'

export function AnswerCard({
  answerKey,
  answerParams,
  figures,
  href,
  tool,
}: {
  answerKey: string
  answerParams: Record<string, unknown>
  figures: AssistantFigure[]
  href: string | null
  tool: string | null
}) {
  const { t, i18n } = useTranslation(['assistant', 'common'])

  /**
   * The sentence.
   *
   * `count` has to be a number for i18next to choose a plural, and a money parameter is formatted
   * before it goes into the sentence — the same two rules the dashboard's health signals follow,
   * for the same reasons. A name the cooperative gave in two languages arrives twice, as `x` and
   * `xRw`, and the reader's language picks.
   */
  const params: Record<string, unknown> = {}
  const rw = i18n.language === 'rw'
  for (const [name, value] of Object.entries(answerParams)) {
    if (name.endsWith('Rw')) continue
    const translated = rw ? answerParams[`${name}Rw`] : undefined
    const chosen = typeof translated === 'string' && translated.length > 0 ? translated : value
    params[name] =
      MONEY_PARAMS.has(name) && typeof chosen === 'string'
        ? formatMoney(chosen, { withCurrency: false })
        : chosen
  }
  if (answerParams.count !== undefined) params.count = Number(answerParams.count)

  const refused = tool === null
  const target = internalPath(href)

  return (
    <Panel>
      <div className="flex flex-col gap-4">
        <p className="text-md text-ink">{t(`assistant:${answerKey}`, params)}</p>

        {refused ? (
          <Alert tone="info" title={t('assistant:refused.title')}>
            {t('assistant:refused.body')}
          </Alert>
        ) : null}

        {figures.length > 0 ? (
          <>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {figures.map((figure) => (
                <div
                  key={`${figure.labelKey}:${figure.value}`}
                  className="rounded-md border border-line bg-surface-subtle p-3"
                >
                  <dt className="text-sm text-ink-muted">
                    {figure.labelKey.startsWith(LITERAL)
                      ? figure.labelKey.slice(LITERAL.length)
                      : t(`assistant:${figure.labelKey}`)}
                  </dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                    {renderFigure(figure, i18n.language)}
                  </dd>
                </div>
              ))}
            </dl>

            {/*
              Where the figure came from. A committee asking "where did that number come from?"
              should not have to ask twice.
            */}
            <p className="flex items-start gap-2 text-xs text-ink-muted">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>{t('assistant:fromTool', { tool: t(`assistant:tools.${tool}`) })}</span>
            </p>
          </>
        ) : null}

        {target ? (
          <Link
            to={target}
            className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"
          >
            {t('assistant:seeForYourself')}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        ) : null}
      </div>
    </Panel>
  )
}

/** Parameters whose values are amounts of money, wherever a tool sends them. */
const MONEY_PARAMS: ReadonlySet<string> = new Set([
  'amount',
  'balance',
  'income',
  'expenses',
  'sold',
])

function renderFigure(figure: AssistantFigure, language: string): string {
  if (figure.type === 'money') return formatMoney(figure.value, { withCurrency: false })
  if (figure.type === 'number') return formatQuantity(figure.value)
  if (figure.type === 'quantity') return formatQuantity(figure.value)
  if (figure.type === 'date' && figure.value.length > 0) {
    return new Intl.DateTimeFormat(language === 'rw' ? 'rw-RW' : 'en-RW', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(`${figure.value}T00:00:00.000Z`))
  }
  return figure.value
}
