/**
 * What the application needs of something that reads a question and picks a tool.
 *
 * Deliberately tiny, and deliberately **not** "something that answers questions". A planner's
 * whole job is to choose one tool from a list and propose its arguments. It never sees a
 * cooperative's rows, never composes a sentence, and never produces a number — those happen after
 * it has finished, in code, from a query.
 *
 * That division is the phase's guarantee. A planner that hallucinated a figure would have nowhere
 * to put it: the answer is assembled from `ToolAnswer`, and the only thing a planner contributes is
 * a key from a list it was handed and arguments that are then parsed against that tool's own
 * schema. The worst a bad planner can do is choose the wrong tool or refuse — both visible, both
 * harmless to the cooperative's figures.
 */

export interface PlannerTool {
  key: string
  /** One line saying what the tool answers, in the reader's language. */
  summary: string
  /** The argument names the tool accepts, so a planner can fill them rather than invent them. */
  argNames: readonly string[]
}

export type Plan =
  | { kind: 'TOOL'; tool: string; args: Record<string, unknown> }
  /**
   * Nothing in the catalogue answers this question.
   *
   * A refusal is a first-class outcome rather than a failure. "I cannot answer that from the
   * cooperative's records" is a true and useful thing to say, and it is the only honest answer
   * when no tool fits — which is why the interface shows it beside a list of what *can* be asked.
   */
  | { kind: 'REFUSE'; reason: 'noToolFits' | 'notAQuestion' }

export interface AssistantPlanner {
  /** A name for the log and the startup line, so an operator can see which planner is live. */
  readonly name: string

  /**
   * True when the planner understands language rather than matching words.
   *
   * The rules planner does not, and it says so: the interface tells a reader to ask plainly and
   * shows examples, rather than letting them phrase a question three ways and conclude the product
   * is broken.
   */
  readonly understandsLanguage: boolean

  /** Never throws. A planner that cannot decide refuses. */
  plan(question: string, tools: readonly PlannerTool[]): Promise<Plan>
}
