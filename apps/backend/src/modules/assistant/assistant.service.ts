import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import type { RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { planner } from '../../lib/assistant/index.js'
import { prisma } from '../../lib/prisma.js'
import { toolsFor, type AssistantTool, type ToolFigure } from './tools.js'
import type { AskInput, ListThreadsQuery } from './assistant.schemas.js'

/**
 * Ask CoopManage.
 *
 * The whole module exists to make one sentence true as a property of the code rather than as a
 * promise: **the assistant cannot state a figure that is not in the cooperative's database, and
 * cannot reach another cooperative's data.** Four things hold it up, and none of them is a prompt
 * instruction.
 *
 * 1. **The catalogue is filtered by permission before the question is read.** A storekeeper's
 *    assistant is handed no tool that knows about money, so no question can reach one.
 * 2. **The planner only chooses.** It returns a tool key from the list it was given and proposes
 *    arguments; those arguments are parsed against that tool's own schema before it runs. It never
 *    sees a row and never writes a word of the answer.
 * 3. **Every figure comes from a query, scoped by `ctx`.** The cooperative comes from the resolved
 *    tenant, exactly as everywhere else. There is no argument that names a cooperative.
 * 4. **The answer is a translation key and its values**, assembled here from what the tool
 *    returned. No prose is stored, so there is nothing a model could have written — and the same
 *    answer reads in English or in Kinyarwanda.
 *
 * What is stored alongside each answer is the tool, its arguments and the rows it returned, so any
 * figure a cooperative reads can be traced back to the query that produced it. That is the
 * difference between an assistant a committee can rely on and one it has to check.
 */

function requireCooperativeId(ctx: RequestContext): string {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()
  return cooperativeId
}

export interface AskAnswer {
  conversationId: string
  messageId: string
  /** The sentence as a key and its values. The interface renders it. */
  answerKey: string
  answerParams: Record<string, unknown>
  figures: ToolFigure[]
  href: string | null
  /** Which tool answered, so the interface can say where the figure came from. */
  tool: string | null
}

/**
 * The argument names a tool accepts, read from its own schema rather than restated.
 *
 * Read rather than declared so the two cannot drift: a tool that gains an argument gains it in the
 * planner's view at the same moment, and a planner cannot be told about an argument the schema
 * would then reject.
 */
function argNamesOf(tool: AssistantTool): readonly string[] {
  return tool.args instanceof z.ZodObject ? Object.keys(tool.args.shape) : []
}

/**
 * Answers one question.
 *
 * The order of operations is the security argument, so it is worth reading in order: the tools are
 * narrowed to what this caller may use, the planner is given only those, its choice is checked
 * against that same set, its arguments are parsed by the chosen tool's schema, and only then does
 * a query run.
 */
export async function ask(ctx: RequestContext, input: AskInput): Promise<AskAnswer> {
  const cooperativeId = requireCooperativeId(ctx)
  const question = input.question.trim()

  const available = toolsFor(ctx)
  const plan = await planner().plan(
    question,
    available.map((tool) => ({
      key: tool.key,
      summary: tool.summaryKey,
      argNames: argNamesOf(tool),
    })),
  )

  const conversation = await openConversation(ctx, cooperativeId, input.conversationId, question)

  await prisma.assistantMessage.create({
    data: { conversationId: conversation.id, role: 'USER', question },
  })

  if (plan.kind === 'REFUSE') {
    // A refusal is an answer, stored like any other. "I cannot answer that from the cooperative's
    // records" is true and useful, and the interface shows it beside what *can* be asked.
    return store(conversation.id, {
      answerKey: `refusal.${plan.reason}`,
      answerParams: {},
      figures: [],
      href: null,
      snapshot: { refused: plan.reason, question },
      tool: null,
      toolArgs: null,
    })
  }

  // Checked against the caller's own set, not against the whole catalogue. A planner proposing a
  // tool outside it would be a planner deciding access, which is not a planner's business.
  const tool = available.find((candidate) => candidate.key === plan.tool)
  if (!tool) {
    logger.warn({ proposed: plan.tool }, 'the planner proposed a tool outside the caller’s set')
    return store(conversation.id, {
      answerKey: 'refusal.noToolFits',
      answerParams: {},
      figures: [],
      href: null,
      snapshot: { refused: 'outsideCatalogue', proposed: plan.tool },
      tool: null,
      toolArgs: null,
    })
  }

  let answer
  try {
    // The arguments are parsed inside `run`, against this tool's own schema. A planner that
    // proposed nonsense gets a refusal, not a query with nonsense in it.
    answer = await tool.run(ctx, plan.args)
  } catch (error) {
    logger.warn({ err: error, tool: tool.key }, 'the assistant could not run a tool')
    return store(conversation.id, {
      answerKey: 'refusal.badArguments',
      answerParams: {},
      figures: [],
      href: null,
      snapshot: { refused: 'badArguments', tool: tool.key, args: plan.args },
      tool: null,
      toolArgs: null,
    })
  }

  return store(conversation.id, {
    answerKey: answer.answerKey,
    answerParams: answer.answerParams,
    figures: answer.figures,
    href: answer.href,
    snapshot: answer.snapshot,
    tool: tool.key,
    toolArgs: plan.args,
  })
}

/** The thread this question belongs to: the one named, or a new one titled by the question. */
async function openConversation(
  ctx: RequestContext,
  cooperativeId: string,
  conversationId: string | undefined,
  question: string,
): Promise<{ id: string }> {
  if (conversationId) {
    const existing = await prisma.assistantConversation.findFirst({
      // Scoped to the cooperative **and** to this reader: a conversation is nobody else's to
      // continue, not even a manager's.
      where: { id: conversationId, cooperativeId, userId: ctx.user.id },
      select: { id: true },
    })
    if (!existing) throw AppError.notFound()
    await prisma.assistantConversation.update({
      where: { id: existing.id },
      data: { updatedAt: new Date() },
    })
    return existing
  }

  return prisma.assistantConversation.create({
    data: {
      cooperativeId,
      userId: ctx.user.id,
      title: question.slice(0, 120),
    },
    select: { id: true },
  })
}

async function store(
  conversationId: string,
  message: {
    answerKey: string
    answerParams: Record<string, unknown>
    figures: ToolFigure[]
    href: string | null
    snapshot: unknown
    tool: string | null
    toolArgs: Record<string, unknown> | null
  },
): Promise<AskAnswer> {
  const row = await prisma.assistantMessage.create({
    data: {
      conversationId,
      role: 'ASSISTANT',
      answerKey: message.answerKey,
      answerParams: message.answerParams as Prisma.InputJsonValue,
      tool: message.tool,
      toolArgs: (message.toolArgs ?? undefined) as Prisma.InputJsonValue | undefined,
      figures: message.figures as unknown as Prisma.InputJsonValue,
      dataSnapshot: message.snapshot as Prisma.InputJsonValue,
      href: message.href,
    },
    select: { id: true },
  })

  return {
    conversationId,
    messageId: row.id,
    answerKey: message.answerKey,
    answerParams: message.answerParams,
    figures: message.figures,
    href: message.href,
    tool: message.tool,
  }
}

// ---------------------------------------------------------------------------
// Reading back
// ---------------------------------------------------------------------------

export interface ThreadRow {
  id: string
  title: string
  messageCount: number
  updatedAt: string
}

export async function listThreads(
  ctx: RequestContext,
  query: ListThreadsQuery,
): Promise<{ items: ThreadRow[]; total: number }> {
  const cooperativeId = requireCooperativeId(ctx)
  const where: Prisma.AssistantConversationWhereInput = { cooperativeId, userId: ctx.user.id }

  const [rows, total] = await Promise.all([
    prisma.assistantConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
    }),
    prisma.assistantConversation.count({ where }),
  ])

  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      messageCount: row._count.messages,
      updatedAt: row.updatedAt.toISOString(),
    })),
    total,
  }
}

export interface ThreadMessage {
  id: string
  role: 'USER' | 'ASSISTANT'
  question: string | null
  answerKey: string | null
  answerParams: Record<string, unknown> | null
  figures: ToolFigure[] | null
  tool: string | null
  href: string | null
  createdAt: string
}

export async function readThread(
  ctx: RequestContext,
  id: string,
): Promise<{ id: string; title: string; messages: ThreadMessage[] }> {
  const cooperativeId = requireCooperativeId(ctx)
  const thread = await prisma.assistantConversation.findFirst({
    where: { id, cooperativeId, userId: ctx.user.id },
    select: {
      id: true,
      title: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          question: true,
          answerKey: true,
          answerParams: true,
          figures: true,
          tool: true,
          href: true,
          createdAt: true,
        },
      },
    },
  })
  // Another reader's thread, and another cooperative's, both read as not found: neither should
  // confirm that it exists.
  if (!thread) throw AppError.notFound()

  return {
    id: thread.id,
    title: thread.title,
    messages: thread.messages.map((row) => ({
      id: row.id,
      role: row.role,
      question: row.question,
      answerKey: row.answerKey,
      answerParams: (row.answerParams as Record<string, unknown> | null) ?? null,
      figures: (row.figures as ToolFigure[] | null) ?? null,
      tool: row.tool,
      href: row.href,
      createdAt: row.createdAt.toISOString(),
    })),
  }
}

/** What this reader can ask, so the screen can show it rather than leave them guessing. */
export function catalogueFor(ctx: RequestContext): {
  planner: string
  understandsLanguage: boolean
  tools: { key: string; summaryKey: string }[]
} {
  const live = planner()
  return {
    planner: live.name,
    understandsLanguage: live.understandsLanguage,
    tools: toolsFor(ctx).map((tool) => ({ key: tool.key, summaryKey: tool.summaryKey })),
  }
}
