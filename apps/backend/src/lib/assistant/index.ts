import { env } from '../../config/env.js'
import { logger } from '../logger.js'
import { RulesPlanner } from './rules.js'
import type { AssistantPlanner } from './types.js'

export type { AssistantPlanner, Plan, PlannerTool } from './types.js'

/**
 * The one place a planner is chosen.
 *
 * **Replacing it is this file and a sibling.** Write a class implementing `AssistantPlanner` next
 * to `rules.ts`, add the branch below, and nothing else changes: the tools, the service, the
 * screens and the guarantee are all untouched, because a planner only ever chooses a tool key and
 * proposes arguments that are parsed against that tool's own schema.
 *
 * Until a model account exists there is one planner and it needs no credentials.
 * `ASSISTANT_PLANNER=model` is refused at startup rather than accepted and then failing on every
 * question — a cooperative discovering the assistant is broken one question at a time is the
 * failure this guard prevents, and it is the same guard `STORAGE_DRIVER` and `SMS_PROVIDER` carry.
 */
function build(): AssistantPlanner {
  const planner = new RulesPlanner()
  logger.info(
    { planner: planner.name, understandsLanguage: planner.understandsLanguage },
    'assistant planner ready',
  )
  return planner
}

let instance: AssistantPlanner | null = null

export function planner(): AssistantPlanner {
  instance ??= build()
  return instance
}

/** Replaces the planner. Tests only — nothing in the application calls it. */
export function setPlanner(next: AssistantPlanner | null): void {
  instance = next
}

/** What the environment asked for, so a startup line and a screen can both name it. */
export const ASSISTANT_PLANNER_NAME = env.ASSISTANT_PLANNER
