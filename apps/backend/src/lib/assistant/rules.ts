import type { AssistantPlanner, Plan, PlannerTool } from './types.js'

/**
 * The planner development runs on, and it needs no credentials of any kind.
 *
 * It matches the words in a question against a table, in English and in Kinyarwanda, and picks the
 * tool with the best score. That is less than a language model would do and it is honest about it:
 * `understandsLanguage` is false, and the interface tells a reader to ask plainly and shows them
 * what can be asked rather than letting them phrase a question three ways and conclude the product
 * is broken.
 *
 * Two reasons this is the driver that ships rather than a stand-in.
 *
 * **It answers the questions a cooperative actually asks.** "How many members do we have?", "how
 * much did we sell this month?", "what is running low?" — a dozen questions that come up daily, in
 * two languages, answered from the database in a few milliseconds and at no cost per question.
 *
 * **It cannot be talked into anything.** There is no prompt to inject into: the question never
 * becomes an instruction, only a bag of words scored against a fixed table. A model-backed planner
 * lands behind the same interface when there is an account to run it under, and the guarantee does
 * not depend on which is live, because neither ever writes a number.
 */

/**
 * Words that point at a tool, with a weight.
 *
 * Kinyarwanda and English together in one list per tool, because a cooperative's staff mix them in
 * a sentence — "how many abanyamuryango" is a question somebody genuinely types. Matching is on
 * stems, so `abanyamuryango`, `umunyamuryango` and `banyamuryango` all hit `nyamuryango`.
 */
interface ToolPatterns {
  tool: string
  /** A hit on any of these is the strong signal: the thing being asked about. */
  subject: readonly string[]
  /** A hit here breaks a tie between two tools about the same subject. */
  qualifier?: readonly string[]
}

const PATTERNS: readonly ToolPatterns[] = [
  {
    tool: 'membersWithoutPhone',
    subject: ['nyamuryango', 'member', 'abanyamuryango'],
    // Checked before `countMembers`, because "how many members have no phone" is about the phone.
    qualifier: ['telefone', 'phone', 'nimero', 'number', 'sms', 'batelefone'],
  },
  {
    tool: 'countMembers',
    subject: ['nyamuryango', 'member', 'abanyamuryango', 'abantu'],
    qualifier: ['bangahe', 'angahe', 'count', 'many', 'umubare', 'total', 'bose'],
  },
  {
    tool: 'contributionsTotal',
    subject: ['musanzu', 'misanzu', 'contribution', 'contributions'],
  },
  {
    tool: 'topExpenseCategories',
    subject: ['yasohotse', 'expense', 'expenses', 'spent', 'sohoka', 'byaguzwe'],
    qualifier: ['icyiciro', 'ibyiciro', 'category', 'categories', 'kuki', 'where', 'aho', 'most'],
  },
  {
    tool: 'financeFlows',
    subject: ['yinjiye', 'income', 'yasohotse', 'expense', 'expenses', 'injira', 'sohoka'],
  },
  {
    tool: 'financeBalance',
    subject: ['asigaye', 'balance', 'amafaranga', 'money', 'cash', 'imari'],
    qualifier: ['asigaye', 'balance', 'dufite', 'have', 'left', 'remaining'],
  },
  {
    tool: 'stockOnHand',
    subject: ['bubiko', 'stock', 'ububiko', 'hari', 'held'],
    // A product named in the question is what tells this apart from the low-stock list.
    qualifier: ['ifumbire', 'imbuto', 'umuti', 'maize', 'ibigori', 'kawa', 'coffee', 'product'],
  },
  {
    tool: 'lowStockProducts',
    subject: ['bubiko', 'stock', 'ububiko', 'bicuruzwa', 'product', 'products'],
    qualifier: ['buke', 'hasi', 'low', 'running', 'ntarengwa', 'minimum', 'shize', 'out'],
  },
  {
    tool: 'outstandingFromBuyers',
    subject: ['mwenda', 'owe', 'owed', 'outstanding', 'ntibyishyuwe', 'unpaid', 'baguzi', 'buyer'],
    qualifier: ['mwenda', 'owe', 'owed', 'outstanding', 'ntibyishyuwe', 'unpaid', 'debt'],
  },
  {
    // Stems rather than whole words: `gurish` covers gurisha, kugurisha and byagurishijwe, and
    // English asks the same question with sell, sold and sales.
    tool: 'salesTotal',
    subject: ['gurish', 'sale', 'sales', 'sold', 'sell', 'selling'],
  },
  {
    tool: 'nextMeeting',
    subject: ['nama', 'inama', 'meeting', 'inteko', 'assembly'],
    qualifier: ['ikurikira', 'next', 'ryari', 'when', 'itaha', 'scheduled'],
  },
  {
    tool: 'openDecisions',
    subject: ['cyemezo', 'byemezo', 'decision', 'decisions', 'action', 'ibikorwa'],
    qualifier: ['bifunguye', 'open', 'birangiye', 'overdue', 'ntibyakozwe', 'pending'],
  },
]

/** A month expressed the handful of ways a cooperative's staff express it. */
const LAST_MONTH = ['ukwezi gushize', 'last month', 'ukwezi kwashize', 'previous month']
const THIS_MONTH = ['uku kwezi', 'this month', 'ukwezi kuriho']
const THIS_YEAR = ['uyu mwaka', 'this year', 'umwaka uriho']

/** Splits a question into lower-cased words with the punctuation removed. */
function words(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1)
}

function hits(haystack: readonly string[], needles: readonly string[]): number {
  let found = 0
  for (const needle of needles) {
    if (haystack.some((word) => word.includes(needle))) found += 1
  }
  return found
}

/** The period the question named, as arguments the tools understand. */
function periodFrom(question: string, now: Date): Record<string, string> {
  const asked = question.toLowerCase()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()

  if (LAST_MONTH.some((phrase) => asked.includes(phrase))) {
    const from = new Date(Date.UTC(year, month - 1, 1))
    const to = new Date(Date.UTC(year, month, 0))
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
  }

  if (THIS_YEAR.some((phrase) => asked.includes(phrase))) {
    return {
      from: new Date(Date.UTC(year, 0, 1)).toISOString().slice(0, 10),
      to: new Date(Date.UTC(year, 11, 31)).toISOString().slice(0, 10),
    }
  }

  // This month is the default the tools already apply, so naming it explicitly changes nothing —
  // and saying nothing is what a question with no period means.
  void THIS_MONTH
  return {}
}

/**
 * The product a question about stock is about.
 *
 * Everything after the stock word, minus the words that are part of the question rather than part
 * of the name. Crude, and it does not have to be better: the tool matches on a substring of the
 * product's own name in either language, so "ifumbire" finds "Ifumbire NPK 17-17-17".
 */
const STOCK_STOPWORDS = new Set([
  'hari',
  'stock',
  'ububiko',
  'bubiko',
  'how',
  'much',
  'many',
  'ni',
  'iki',
  'mu',
  'dufite',
  'have',
  'we',
  'of',
  'in',
  'the',
  'is',
  'there',
  'left',
  'do',
  'what',
  'ese',
  'naho',
  'kuri',
  'ku',
  'bya',
  'by',
  'ya',
  'wa',
  'cya',
  'byo',
  'remaining',
  'hold',
  'holding',
  // The Kinyarwanda "how many" — bingahe, bangahe, ingahe, angahe — is a question word, and a
  // planner that read it as a product name asked the stock tool about a product called "bingahe".
  // "Hari bingahe?" has no product in it and the honest answer is a refusal.
  'ingahe',
  'bingahe',
  'bangahe',
  'angahe',
  'zingahe',
  'kingahe',
])

function productFrom(question: string): string | null {
  const candidates = words(question).filter((word) => !STOCK_STOPWORDS.has(word))
  // The longest remaining word is nearly always the name: "ifumbire", "imbuto", "pesticide".
  const best = candidates.sort((a, b) => b.length - a.length)[0]
  return best && best.length >= 3 ? best : null
}

export class RulesPlanner implements AssistantPlanner {
  readonly name = 'rules'
  readonly understandsLanguage = false

  plan(question: string, tools: readonly PlannerTool[]): Promise<Plan> {
    const asked = words(question)
    if (asked.length === 0) {
      return Promise.resolve({ kind: 'REFUSE', reason: 'notAQuestion' })
    }

    const available = new Set(tools.map((tool) => tool.key))
    let best: { tool: string; score: number } | null = null

    for (const pattern of PATTERNS) {
      // A tool the caller may not use is not a candidate. The catalogue was already filtered by
      // permission before this was called; this is the second place the same rule holds, because
      // a planner that proposed a tool outside the set would be a planner deciding access.
      if (!available.has(pattern.tool)) continue

      const subject = hits(asked, pattern.subject)
      if (subject === 0) continue
      const qualifier = pattern.qualifier ? hits(asked, pattern.qualifier) : 0

      // The subject is what the question is about; a qualifier only breaks ties. Weighting them
      // the other way round makes "how many members" land on whichever tool happens to share a
      // qualifier word.
      const score = subject * 2 + qualifier * 3
      if (!best || score > best.score) best = { tool: pattern.tool, score }
    }

    if (!best) return Promise.resolve({ kind: 'REFUSE', reason: 'noToolFits' })

    const chosen = tools.find((tool) => tool.key === best.tool)
    if (!chosen) return Promise.resolve({ kind: 'REFUSE', reason: 'noToolFits' })

    const args: Record<string, unknown> = {}
    if (chosen.argNames.includes('from') || chosen.argNames.includes('to')) {
      Object.assign(args, periodFrom(question, new Date()))
    }
    if (chosen.argNames.includes('name')) {
      const name = productFrom(question)
      // A stock question with no product named in it is a question this tool cannot answer. The
      // low-stock list is the one that answers "what is running low", and refusing here rather
      // than guessing a name is what keeps the answer traceable.
      if (!name) return Promise.resolve({ kind: 'REFUSE', reason: 'noToolFits' })
      args.name = name
    }

    return Promise.resolve({ kind: 'TOOL', tool: best.tool, args })
  }
}
