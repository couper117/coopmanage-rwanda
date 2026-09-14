/**
 * The settings catalogue.
 *
 * `CooperativeSetting` and `SystemSetting` store JSON against a key, which without a catalogue
 * would be an arbitrary dump that no screen could rely on and no review could audit. Every key a
 * cooperative or the platform may set is declared here, with its shape and its default, and the
 * backend refuses a key it does not recognise.
 *
 * The catalogue grows as phases need keys. It is deliberately small: a setting exists only once
 * something actually reads it.
 */

/**
 * Modules a cooperative cannot switch off, because the product does not mean anything without
 * them. A cooperative always has members, always has money and always needs reports.
 */
export const CORE_MODULES = ['members', 'finance', 'reports'] as const

/**
 * Modules a cooperative may switch off, so that a transport cooperative is not made to navigate
 * past Inventory and a trading cooperative past Contributions. This is the "configurable modules"
 * requirement: one codebase, adapted by configuration rather than by forking.
 */
export const OPTIONAL_MODULES = [
  'contributions',
  'inventory',
  'products',
  'sales',
  'buyers',
  'meetings',
  'documents',
  'announcements',
  'assistant',
] as const

export type CoreModule = (typeof CORE_MODULES)[number]
export type OptionalModule = (typeof OPTIONAL_MODULES)[number]
export type ModuleKey = CoreModule | OptionalModule

export const ALL_MODULES: readonly ModuleKey[] = [...CORE_MODULES, ...OPTIONAL_MODULES]

export function isOptionalModule(value: string): value is OptionalModule {
  return (OPTIONAL_MODULES as readonly string[]).includes(value)
}

/** Cooperative-scoped setting keys. */
export const COOPERATIVE_SETTING_KEYS = ['enabledModules'] as const
export type CooperativeSettingKey = (typeof COOPERATIVE_SETTING_KEYS)[number]

/** Platform-scoped setting keys. */
export const SYSTEM_SETTING_KEYS = ['defaultCooperativeLocale'] as const
export type SystemSettingKey = (typeof SYSTEM_SETTING_KEYS)[number]

export interface CooperativeSettings {
  /**
   * Optional modules this cooperative has switched on. Core modules are always available and are
   * not listed here. An absent setting means every optional module is on, which is the right
   * default: a new cooperative should see the whole product and remove what it does not use.
   */
  enabledModules: OptionalModule[]
}

export interface SystemSettings {
  /** The interface language a newly created cooperative starts in. */
  defaultCooperativeLocale: 'EN' | 'RW'
}

export const COOPERATIVE_SETTING_DEFAULTS: CooperativeSettings = {
  enabledModules: [...OPTIONAL_MODULES],
}

export const SYSTEM_SETTING_DEFAULTS: SystemSettings = {
  defaultCooperativeLocale: 'RW',
}

export function isCooperativeSettingKey(value: string): value is CooperativeSettingKey {
  return (COOPERATIVE_SETTING_KEYS as readonly string[]).includes(value)
}

export function isSystemSettingKey(value: string): value is SystemSettingKey {
  return (SYSTEM_SETTING_KEYS as readonly string[]).includes(value)
}

/**
 * True when a module is available to a cooperative. Core modules are always available; optional
 * ones depend on the setting. Availability is separate from permission: a module can be switched
 * on for the cooperative and still be invisible to a member of staff whose role does not cover it.
 */
export function isModuleEnabled(
  module: ModuleKey,
  settings: Pick<CooperativeSettings, 'enabledModules'>,
): boolean {
  if ((CORE_MODULES as readonly string[]).includes(module)) return true
  return settings.enabledModules.includes(module as OptionalModule)
}
