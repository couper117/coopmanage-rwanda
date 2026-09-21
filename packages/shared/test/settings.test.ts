import { describe, expect, it } from 'vitest'
import {
  ALL_MODULES,
  COOPERATIVE_SETTING_DEFAULTS,
  CORE_MODULES,
  isCooperativeSettingKey,
  isModuleEnabled,
  isOptionalModule,
  isSystemSettingKey,
  OPTIONAL_MODULES,
} from '../src/settings.js'

describe('modules', () => {
  it('are either core or optional, and never both', () => {
    for (const module of CORE_MODULES) expect(isOptionalModule(module)).toBe(false)
    for (const module of OPTIONAL_MODULES) expect(isOptionalModule(module)).toBe(true)
    expect(isOptionalModule('payroll')).toBe(false)
    expect(new Set(ALL_MODULES).size).toBe(CORE_MODULES.length + OPTIONAL_MODULES.length)
  })

  it('start all switched on for a new cooperative', () => {
    expect(COOPERATIVE_SETTING_DEFAULTS.enabledModules).toEqual([...OPTIONAL_MODULES])
  })

  it('cannot switch off a core module, and respect the setting for an optional one', () => {
    const nothingOn = { enabledModules: [] }
    for (const module of CORE_MODULES) expect(isModuleEnabled(module, nothingOn)).toBe(true)
    for (const module of OPTIONAL_MODULES) expect(isModuleEnabled(module, nothingOn)).toBe(false)

    const one = OPTIONAL_MODULES[0]
    expect(isModuleEnabled(one, { enabledModules: [one] })).toBe(true)
  })
})

describe('setting keys', () => {
  it('are recognised by exact name, so a setting typed wrong is refused rather than stored', () => {
    expect(isCooperativeSettingKey('enabledModules')).toBe(true)
    expect(isCooperativeSettingKey('enabled_modules')).toBe(false)
    expect(isSystemSettingKey('defaultCooperativeLocale')).toBe(true)
    expect(isSystemSettingKey('enabledModules')).toBe(false)
  })
})
