import { MessageCircleQuestion, Send, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { Alert, Button, EmptyState, Panel, Skeleton, Textarea } from '@/components/ui'
import { AnswerCard } from '@/features/assistant/AnswerCard'
import type { AssistantAnswer } from '@/features/assistant/assistant.api'
import {
  useAsk,
  useAssistantCatalogue,
  useAssistantError,
  useThreads,
} from '@/features/assistant/assistant.hooks'

/**
 * Ask CoopManage.
 *
 * The screen is built around one honest admission and one guarantee.
 *
 * **The admission.** While the planner matches words rather than understanding language, the screen
 * says so and lists what can be asked. The alternative is a blank box that invites any question and
 * refuses most of them, which teaches a cooperative that the feature does not work rather than that
 * it answers a dozen questions well.
 *
 * **The guarantee.** Every answer arrives as a key, its values and the figures behind it, so what
 * this page renders is a sentence in the reader's language over figures that came from a query.
 * There is no path by which a number appears here that is not in the cooperative's database.
 */
export function AssistantPage() {
  const { t } = useTranslation(['assistant', 'common'])
  const describeError = useAssistantError()
  const catalogue = useAssistantCatalogue()
  const threads = useThreads()
  const ask = useAsk()

  const [question, setQuestion] = useState('')
  /**
   * The exchange on screen, newest last.
   *
   * Held here rather than read back from the thread, so an answer appears the moment it arrives
   * rather than after a refetch — on a district-office connection the difference is a second and a
   * half of an apparently dead button.
   */
  const [exchange, setExchange] = useState<{ question: string; answer: AssistantAnswer }[]>([])
  const [conversationId, setConversationId] = useState<string | undefined>(undefined)

  function submit(): void {
    const asked = question.trim()
    if (asked.length < 3) return

    ask.mutate(
      { question: asked, conversationId },
      {
        onSuccess: (answer) => {
          setExchange((current) => [...current, { question: asked, answer }])
          setConversationId(answer.conversationId)
          setQuestion('')
        },
      },
    )
  }

  const tools = catalogue.data?.tools ?? []

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('assistant:title')} description={t('assistant:description')} />

      {/*
        Said before the first question rather than after a refusal. A reader who knows the
        assistant matches words asks plainly; one who does not concludes it is broken.
      */}
      {catalogue.data && !catalogue.data.understandsLanguage ? (
        <Alert tone="info" title={t('assistant:plainly.title')}>
          {t('assistant:plainly.body')}
        </Alert>
      ) : null}

      <Panel>
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Textarea
            rows={2}
            value={question}
            aria-label={t('assistant:field.question')}
            placeholder={t('assistant:field.placeholder')}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              // Enter asks; shift-Enter is a new line. A question is one line far more often than
              // it is two, and reaching for a button after every question is a slow way to work.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">{t('assistant:field.hint')}</p>
            <Button
              type="submit"
              loading={ask.isPending}
              disabled={question.trim().length < 3}
              leadingIcon={<Send aria-hidden="true" className="size-4" />}
            >
              {t('assistant:field.ask')}
            </Button>
          </div>
        </form>
      </Panel>

      {ask.isError ? <Alert tone="danger">{describeError(ask.error).message}</Alert> : null}

      {exchange.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Sparkles}
            title={t('assistant:empty.title')}
            description={t('assistant:empty.body')}
            headingLevel={2}
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {exchange.map((turn) => (
            <div key={turn.answer.messageId} className="flex flex-col gap-2">
              <p className="flex items-start gap-2 text-sm font-medium text-ink-secondary">
                <MessageCircleQuestion aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {turn.question}
              </p>
              <AnswerCard
                answerKey={turn.answer.answerKey}
                answerParams={turn.answer.answerParams}
                figures={turn.answer.figures}
                href={turn.answer.href}
                tool={turn.answer.tool}
              />
            </div>
          ))}
        </div>
      )}

      {/*
        What this reader can ask. The list is theirs rather than the product's: it comes from the
        catalogue filtered by their own permissions, so a storekeeper is not shown a question about
        money that would only ever be refused.
      */}
      <Panel title={t('assistant:canAsk.title')} description={t('assistant:canAsk.body')}>
        {catalogue.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {tools.map((tool) => (
              <li key={tool.key} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => setQuestion(t(`assistant:examples.${tool.key}`))}
                  className="self-start text-left text-primary-600 hover:underline"
                >
                  {t(`assistant:examples.${tool.key}`)}
                </button>
                <span className="text-xs text-ink-muted">{t(`assistant:${tool.summaryKey}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {threads.data && threads.data.items.length > 0 ? (
        <Panel title={t('assistant:history.title')} description={t('assistant:history.body')}>
          <ul className="flex flex-col gap-1 text-sm">
            {threads.data.items.slice(0, 8).map((thread) => (
              <li key={thread.id} className="truncate text-ink-secondary">
                {thread.title}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  )
}
