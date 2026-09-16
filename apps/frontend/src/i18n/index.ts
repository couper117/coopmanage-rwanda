import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import type { Locale } from '@coopmanage/shared'
import { LANGUAGE_TO_LOCALE, LOCALE_TO_LANGUAGE } from '@coopmanage/shared'

import enAuth from './locales/en/auth.json'
import enCommon from './locales/en/common.json'
import enDashboard from './locales/en/dashboard.json'
import enErrors from './locales/en/errors.json'
import enModules from './locales/en/modules.json'
import enNav from './locales/en/nav.json'
import enNotifications from './locales/en/notifications.json'
import enValidation from './locales/en/validation.json'
import rwAuth from './locales/rw/auth.json'
import rwCommon from './locales/rw/common.json'
import rwDashboard from './locales/rw/dashboard.json'
import rwErrors from './locales/rw/errors.json'
import rwModules from './locales/rw/modules.json'
import rwNav from './locales/rw/nav.json'
import rwNotifications from './locales/rw/notifications.json'
import rwValidation from './locales/rw/validation.json'

export const SUPPORTED_LANGUAGES = ['en', 'rw'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

export const LANGUAGE_STORAGE_KEY = 'coopmanage.language'

/**
 * The strings the shell needs before anything else can render: the navigation, the errors, the
 * validation messages, the sign-in screen, the dashboard and the words shared by every screen.
 *
 * Both languages ship together, because the language switch has to be instant — a cooperative
 * changing it should see the interface change, not a loading state — and because these seven
 * namespaces are a small fraction of the whole.
 */
export const CORE_NAMESPACES = [
  'common',
  'nav',
  'auth',
  'errors',
  'validation',
  'dashboard',
  'notifications',
  'modules',
] as const

/**
 * Everything else, fetched when the screen that needs it is opened.
 *
 * A cooperative's translations came to 340 kB, all of it in the first download, for screens most
 * users never open in a given session. The route loaders in `app/routes.tsx` and each feature's
 * route file await the namespaces their screen needs alongside the screen's own code, so the wait
 * is one wait and the strings are always there before the first render — never a screen that shows
 * its keys for a moment and then corrects itself.
 */
export const FEATURE_NAMESPACES = [
  'members',
  'finance',
  'inventory',
  'sales',
  'reports',
  'documents',
  'meetings',
  'admin',
  'audit',
  'settings',
  'staff',
  'profile',
] as const

export type FeatureNamespace = (typeof FEATURE_NAMESPACES)[number]

/**
 * The namespaces an audit entry or a notification can quote.
 *
 * The backend sends an enum inside a message as a **key** rather than as its raw value, because
 * `SAVINGS` in the middle of a Kinyarwanda sentence is not a translation. Those keys come from
 * whichever module wrote the entry, so the activity log genuinely needs nearly every namespace —
 * and a screen that loaded only its own would print `contributions.type.SAVINGS` at a reader.
 *
 * So the audit route pays for all of them, once, when somebody opens the activity log. That is the
 * honest cost of a screen that quotes the whole application.
 */
export const AUDIT_MESSAGE_NAMESPACES = [
  'audit',
  'members',
  'finance',
  'inventory',
  'sales',
  'meetings',
  'documents',
  'reports',
  'staff',
  'settings',
] as const satisfies readonly FeatureNamespace[]

export const NAMESPACES = [...CORE_NAMESPACES, ...FEATURE_NAMESPACES]

/**
 * The core resources, bundled.
 *
 * `resources` no longer holds every namespace, so the translation parity test reads the JSON files
 * directly rather than through this object: a test that imported the whole set from here would put
 * the whole set back into the application bundle.
 */
export const resources = {
  en: {
    common: enCommon,
    nav: enNav,
    auth: enAuth,
    errors: enErrors,
    validation: enValidation,
    dashboard: enDashboard,
    notifications: enNotifications,
    modules: enModules,
  },
  rw: {
    common: rwCommon,
    nav: rwNav,
    auth: rwAuth,
    errors: rwErrors,
    validation: rwValidation,
    dashboard: rwDashboard,
    notifications: rwNotifications,
    modules: rwModules,
  },
} as const

/**
 * Where a feature namespace's strings come from.
 *
 * Written out rather than built from a template, because a bundler needs to see each import to
 * split it: `import(\`./locales/${language}/${namespace}.json\`)` produces one chunk containing
 * every file that could match, which is the problem this is here to solve.
 */
const LOADERS: Readonly<
  Record<Language, Readonly<Record<FeatureNamespace, () => Promise<unknown>>>>
> = {
  en: {
    members: () => import('./locales/en/members.json'),
    finance: () => import('./locales/en/finance.json'),
    inventory: () => import('./locales/en/inventory.json'),
    sales: () => import('./locales/en/sales.json'),
    reports: () => import('./locales/en/reports.json'),
    documents: () => import('./locales/en/documents.json'),
    meetings: () => import('./locales/en/meetings.json'),
    admin: () => import('./locales/en/admin.json'),
    audit: () => import('./locales/en/audit.json'),
    settings: () => import('./locales/en/settings.json'),
    staff: () => import('./locales/en/staff.json'),
    profile: () => import('./locales/en/profile.json'),
  },
  rw: {
    members: () => import('./locales/rw/members.json'),
    finance: () => import('./locales/rw/finance.json'),
    inventory: () => import('./locales/rw/inventory.json'),
    sales: () => import('./locales/rw/sales.json'),
    reports: () => import('./locales/rw/reports.json'),
    documents: () => import('./locales/rw/documents.json'),
    meetings: () => import('./locales/rw/meetings.json'),
    admin: () => import('./locales/rw/admin.json'),
    audit: () => import('./locales/rw/audit.json'),
    settings: () => import('./locales/rw/settings.json'),
    staff: () => import('./locales/rw/staff.json'),
    profile: () => import('./locales/rw/profile.json'),
  },
}

/** Which feature namespaces a screen has asked for, so a language change can reload them. */
const requested = new Set<FeatureNamespace>()

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    defaultNS: 'common',
    ns: [...CORE_NAMESPACES],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      // React escapes for us; double-escaping would show entities in the interface.
      escapeValue: false,
    },
    returnNull: false,
  })
  .then(() => {
    // init resolves synchronously with bundled resources, so the languageChanged listener below
    // never fires for the initial language. Setting it here is what makes a screen reader use the
    // right voice on first load for a user whose stored preference is Kinyarwanda.
    if (typeof document !== 'undefined') {
      document.documentElement.lang = i18n.resolvedLanguage ?? 'en'
    }
  })
  .catch((error: unknown) => {
    // Without resources every label would render as its key, so this must not pass unnoticed.
    console.error('Failed to initialise translations', error)
  })

/** Keeps the document language attribute in step, which screen readers rely on. */
i18n.on('languageChanged', (language) => {
  if (typeof document !== 'undefined') document.documentElement.lang = language
})

export function currentLanguage(): Language {
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(language)
    ? (language as Language)
    : 'en'
}

export function currentLocale(): Locale {
  return LANGUAGE_TO_LOCALE[currentLanguage()]
}

/**
 * Makes sure a screen's strings are present before it renders.
 *
 * Called from a route's lazy loader, so the namespace arrives with the screen's code and the
 * `Suspense` boundary covers both. A namespace already registered is not fetched again, so
 * navigating back to a screen costs nothing.
 *
 * A failure is swallowed after logging: the screen renders with its keys visible, which is ugly
 * and far better than a blank page. That trade-off is only acceptable because the core namespaces
 * — every error message and every button — are bundled and cannot fail.
 */
export async function loadNamespaces(
  namespaces: readonly FeatureNamespace[],
  language: Language = currentLanguage(),
): Promise<void> {
  await Promise.all(
    namespaces.map(async (namespace) => {
      requested.add(namespace)
      if (i18n.hasResourceBundle(language, namespace)) return

      try {
        const loaded = (await LOADERS[language][namespace]()) as { default: object }
        i18n.addResourceBundle(language, namespace, loaded.default, true, true)
      } catch (error) {
        console.error(`Failed to load the ${language} strings for ${namespace}`, error)
      }
    }),
  )
}

/**
 * Switches language, bringing every namespace already in use with it.
 *
 * The order matters: the namespaces are loaded **before** `changeLanguage`, so the interface never
 * renders a screen in the new language with the old language's strings missing. A cooperative
 * switching to Kinyarwanda on the sales screen sees the sales screen in Kinyarwanda, not a flash
 * of `sales.title`.
 */
export async function changeLanguage(language: Language): Promise<void> {
  await loadNamespaces([...requested], language)
  await i18n.changeLanguage(language)
}

export async function applyLocale(locale: Locale): Promise<void> {
  await changeLanguage(LOCALE_TO_LANGUAGE[locale])
}

export default i18n
