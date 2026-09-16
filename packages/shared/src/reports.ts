import type { Locale } from './enums.js'
import { formatMoney, formatQuantity } from './format.js'
import type { PermissionKey } from './permissions.js'

/**
 * The report catalogue.
 *
 * This lives in the shared package rather than in either application because both need exactly the
 * same labels, and they must not drift. The screen renders a report for the reader; the server
 * renders the same report into a PDF, a CSV and a spreadsheet. If the two held their own copies of
 * "Money in", a cooperative would eventually hand a lender a sheet of paper that disagreed with the
 * screen it was read from.
 *
 * It is also the one place in this product where user-facing strings live outside the frontend's
 * translation files, and that is a deliberate exception with a reason: a PDF is produced on the
 * server, in the language the reader asked for, and a server cannot reach into the browser's
 * translations. The parity of these two languages is covered by a test, the same way the
 * interface's own translations are.
 */

export const REPORT_TYPES = [
  'monthly-cooperative',
  'financial',
  'member',
  'inventory',
  'sales',
  'activity',
  'meeting',
] as const

export type ReportType = (typeof REPORT_TYPES)[number]

export const REPORT_FORMATS = ['pdf', 'csv', 'xlsx'] as const
export type ReportFormat = (typeof REPORT_FORMATS)[number]

export interface ReportDefinition {
  type: ReportType
  /** What a reader has to hold to see this report's figures at all. */
  permission: PermissionKey
  /**
   * Permissions that unlock a section within the report. A reader missing one gets the report with
   * that section named as withheld rather than silently absent, because a report with a section
   * quietly missing is one somebody will draw a conclusion from.
   */
  sectionPermissions: Partial<Record<string, PermissionKey>>
  /** True once the data the report needs exists. A report whose phase has not landed says so. */
  available: boolean
  /** The phase that brings it, for the message shown while it is unavailable. */
  availableFromPhase: number
}

/**
 * The seven reports, and what each one needs.
 *
 * `monthly-cooperative` is the one that matters most and the reason the others exist: it is what a
 * cooperative reads out at a general assembly, and it is assembled from every module. Its sections
 * are each gated by the permission covering their own data, so a secretary printing it gets the
 * membership and the meetings and is told the money was withheld.
 */
export const REPORTS: Readonly<Record<ReportType, ReportDefinition>> = {
  'monthly-cooperative': {
    type: 'monthly-cooperative',
    permission: 'reports:view',
    sectionPermissions: {
      members: 'members:view',
      finance: 'finance:view',
      inventory: 'inventory:view',
      sales: 'sales:view',
    },
    available: true,
    availableFromPhase: 8,
  },
  financial: {
    type: 'financial',
    permission: 'finance:view',
    sectionPermissions: {},
    available: true,
    availableFromPhase: 8,
  },
  member: {
    type: 'member',
    permission: 'members:view',
    sectionPermissions: {
      contributions: 'contributions:view',
      shares: 'shares:view',
    },
    available: true,
    availableFromPhase: 8,
  },
  inventory: {
    type: 'inventory',
    permission: 'inventory:view',
    sectionPermissions: { valuation: 'finance:view' },
    available: true,
    availableFromPhase: 8,
  },
  sales: {
    type: 'sales',
    permission: 'sales:view',
    sectionPermissions: {},
    available: true,
    availableFromPhase: 8,
  },
  activity: {
    type: 'activity',
    permission: 'audit:view',
    sectionPermissions: {},
    available: true,
    availableFromPhase: 8,
  },
  meeting: {
    type: 'meeting',
    permission: 'meetings:view',
    sectionPermissions: {},
    // Arrived in Phase 9 with the meetings module. Until then it was listed and refused with its
    // phase rather than hidden, so a cooperative expecting a minutes report was told when it would
    // come rather than left to wonder whether they had the wrong menu.
    available: true,
    availableFromPhase: 9,
  },
}

/**
 * Everything a report puts on paper, in the order it appears.
 *
 * One structure, several renderers: the screen, the PDF, the CSV and the spreadsheet all walk this.
 * That is what makes the printed sheet and the page it was read from the same document rather than
 * two attempts at it.
 *
 * Values are held **raw** — a decimal string for money, an ISO date for a date — and formatted at
 * the point of rendering by `formatReportValue`. Storing the formatted text instead would have been
 * less code and a worse idea: the spreadsheet needs a real number in the amount column so the first
 * thing anybody does with the file (select the column, look at the sum) works, and the CSV needs a
 * value a spreadsheet can parse rather than one with thousands separators in it.
 */

/** What a value is, which decides how each renderer writes it. */
export type ReportValueType = 'text' | 'money' | 'quantity' | 'number' | 'date'

export interface ReportFigure {
  key: string
  label: string
  type: ReportValueType
  /** Raw: a decimal string, an integer as a string, or an ISO date. */
  value: string
  /** A short qualifier printed under the figure, already translated. */
  hint?: string
}

export interface ReportColumn {
  key: string
  label: string
  type: ReportValueType
  /** Numbers right-align on paper; text does not. Derived from the type unless stated. */
  align?: 'left' | 'right'
  /** A relative weight used to divide the printable width. Defaults to 1. */
  weight?: number
}

/** One table row. A null cell prints as nothing rather than as the word "null". */
export type ReportRow = Record<string, string | null>

export type ReportSection =
  | { kind: 'figures'; key: string; figures: ReportFigure[] }
  | {
      kind: 'table'
      key: string
      columns: ReportColumn[]
      rows: ReportRow[]
      /** A totals row, where the report has one. Keyed by column, same raw values. */
      total?: ReportRow
      /** Said instead of an empty table, because "none" and "nothing yet" are different answers. */
      emptyLabel?: string
      /** How many rows the table would have had, when it shows only the first of them. */
      truncatedFrom?: number
    }
  | { kind: 'note'; key: string; text: string }
  | {
      kind: 'withheld'
      key: string
      /** Named rather than omitted: a section quietly missing is one somebody draws a conclusion from. */
      text: string
    }

export interface ReportDocument {
  type: ReportType
  title: string
  /** A subtitle, where the report is about one member or one store. */
  subtitle?: string
  /** The period in words, as it is printed: "1 September to 30 September 2026". */
  periodLabel: string
  from: string
  to: string
  locale: Locale
  currency: string
  cooperative: { name: string; code: string; district: string; sector: string }
  sections: (ReportSection & { title: string })[]
  generatedAt: string
  /** Already written out for print, in the report's own language. */
  generatedAtLabel: string
  generatedBy: string
  /** Which sections the reader may not see, so the interface can say so in one place too. */
  withheld: string[]
  /** What the run covered, recorded against the run so a list is legible without re-running it. */
  rowCount: number
}

const MONTHS: Readonly<Record<Locale, readonly string[]>> = {
  EN: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  RW: [
    'Mutarama',
    'Gashyantare',
    'Werurwe',
    'Mata',
    'Gicurasi',
    'Kamena',
    'Nyakanga',
    'Kanama',
    'Nzeri',
    'Ukwakira',
    'Ugushyingo',
    'Ukuboza',
  ],
}

/**
 * `2026-09-30` becomes `30 September 2026` or `30 Nzeri 2026`.
 *
 * Tabulated rather than taken from `Intl` for the same reason the digit grouping above is: a report
 * rendered on the server must read exactly like the screen it was produced from, and Kinyarwanda
 * locale data is not present in every JavaScript runtime. A table is also the only way to be sure
 * the Kinyarwanda month is the one a Rwandan reader expects rather than whatever the runtime holds.
 */
export function reportDate(iso: string, locale: Locale): string {
  const [year = '', month = '', day = ''] = iso.slice(0, 10).split('-')
  const name = MONTHS[locale][Number(month) - 1] ?? month
  return `${Number(day)} ${name} ${year}`
}

/**
 * The period as it is printed at the top of a report.
 *
 * The year is written once when both dates fall in it — "1 September to 30 September 2026" rather
 * than "1 September 2026 to 30 September 2026" — because that is how a period is written by hand,
 * and a heading is read at a glance. Across a year boundary both years are written, which is the
 * one case where the repetition is the point.
 */
export function reportPeriodLabel(from: string, to: string, locale: Locale): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  const start = sameYear
    ? reportDate(from, locale).replace(` ${from.slice(0, 4)}`, '')
    : reportDate(from, locale)
  return reportLabel(locale, 'report.period', { from: start, to: reportDate(to, locale) })
}

/**
 * Turns a raw value into the text a reader sees. Every renderer calls this, so the figure on the
 * screen and the figure on the paper cannot differ.
 */
export function formatReportValue(
  type: ReportValueType,
  value: string | null,
  options: { locale: Locale; currency?: string } = { locale: 'EN' },
): string {
  if (value === null || value === '') return ''
  switch (type) {
    case 'money':
      return formatMoney(value, { currency: options.currency, withCurrency: false })
    case 'quantity':
      return formatQuantity(value)
    case 'number':
      return formatQuantity(value)
    case 'date':
      return reportDate(value, options.locale)
    case 'text':
      return value
  }
}

/** Numbers right-align on paper. A column may still override it. */
export function reportColumnAlign(column: ReportColumn): 'left' | 'right' {
  if (column.align) return column.align
  return column.type === 'money' || column.type === 'quantity' || column.type === 'number'
    ? 'right'
    : 'left'
}

/**
 * Every label a report prints, in both languages.
 *
 * The `enum.*` labels are **copies of the interface's own translations**, not a second translation
 * of the same words. A report that called a suspended member something different from the member
 * screen would be a report somebody quotes against the screen and loses an argument over, so
 * `apps/frontend/test/reportLabels.test.ts` compares the two and fails the build when they drift.
 */
type LabelBundle = Readonly<Record<string, string>>

const EN: LabelBundle = {
  'report.monthly-cooperative': 'Monthly cooperative report',
  'report.financial': 'Financial report',
  'report.member': 'Membership report',
  'report.inventory': 'Stock report',
  'report.sales': 'Sales report',
  'report.activity': 'Activity report',
  'report.meeting': 'Meeting minutes report',

  'report.generatedBy': 'Produced by {name}',
  'report.generatedAt': 'Produced on {when}',
  'report.period': '{from} to {to}',
  'report.page': 'Page {page}',
  'report.withheld': 'The {section} section is not shown, because your role does not cover it.',
  'report.unavailable': 'This report needs data that arrives in phase {phase}.',
  'report.none': 'Nothing recorded in this period.',
  'report.unpriced': '{count} products have no recorded cost and are not counted in this figure.',
  'report.truncated':
    'Showing the first {shown} of {total} rows. Export the report for all of them.',

  'section.members': 'Membership',
  'section.finance': 'Money',
  'section.inventory': 'Stock',
  'section.sales': 'Sales',
  'section.contributions': 'Contributions',
  'section.shares': 'Shares',
  'section.valuation': 'What the stock is worth',
  'section.categories': 'By category',
  'section.movements': 'Stock movements',
  'section.lowStock': 'Running low',
  'section.topBuyers': 'Biggest buyers',
  'section.topProducts': 'Most sold',
  'section.entries': 'Every entry',
  'section.register': 'The register',
  'section.activity': 'What was done',
  'section.meetings': 'Meetings',
  'section.decisions': 'Decisions and actions',
  'section.attendance': 'Attendance',

  'figure.members.total': 'Members',
  'figure.members.active': 'Active members',
  'figure.members.joined': 'Joined in this period',
  'figure.members.withoutPhone': 'Without a phone number',
  'figure.finance.opening': 'Balance at the start',
  'figure.finance.income': 'Money in',
  'figure.finance.expenses': 'Money out',
  'figure.finance.net': 'Difference',
  'figure.finance.closing': 'Balance at the end',
  'figure.inventory.products': 'Products counted',
  'figure.inventory.low': 'At or below their minimum',
  'figure.inventory.value': 'What the stock is worth',
  'figure.inventory.received': 'Received in this period',
  'figure.inventory.issued': 'Went out in this period',
  'figure.sales.count': 'Sales confirmed',
  'figure.sales.sold': 'Sold',
  'figure.sales.paid': 'Paid',
  'figure.sales.outstanding': 'Still owed',
  'figure.contributions.count': 'Contributions',
  'figure.contributions.total': 'Contributions total',
  'figure.shares.quantity': 'Shares held',
  'figure.shares.value': 'Share capital',
  'figure.activity.entries': 'Actions recorded',
  'figure.meetings.held': 'Meetings held',
  'figure.meetings.cancelled': 'Meetings cancelled',
  'figure.meetings.decisions': 'Decisions recorded',
  'figure.meetings.actionsOpen': 'Actions still open',
  'figure.meetings.attendance': 'Average attendance',

  'column.date': 'Date',
  'column.reference': 'Reference',
  'column.kind': 'Kind',
  'column.category': 'Category',
  'column.method': 'How it was paid',
  'column.description': 'Description',
  'column.amount': 'Amount',
  'column.member': 'Member',
  'column.memberCode': 'Member code',
  'column.phone': 'Phone number',
  'column.position': 'Position',
  'column.status': 'State',
  'column.joinedOn': 'Joined',
  'column.product': 'Product',
  'column.sku': 'Code',
  'column.warehouse': 'Store',
  'column.quantity': 'Quantity',
  'column.unit': 'Unit',
  'column.minimum': 'Minimum',
  'column.value': 'Value',
  'column.unitCost': 'Cost of one',
  'column.buyer': 'Buyer',
  'column.sales': 'Sales',
  'column.total': 'Total',
  'column.paid': 'Paid',
  'column.outstanding': 'Still owed',
  'column.who': 'Who',
  'column.what': 'What happened',
  'column.share': 'Share',
  'column.count': 'Number',
  'column.detail': 'Details',
  'column.meeting': 'Meeting',
  'column.attendees': 'Present',
  'column.quorum': 'Quorum',
  'column.decision': 'Decision',
  'column.votes': 'For / against / abstained',
  'column.responsible': 'Responsible',
  'column.due': 'Due',
  'column.minutes': 'Minutes',

  'report.quorumMet': 'Met',
  'report.quorumNotMet': 'Not met',
  'report.quorumNone': 'Not set',
  'report.minutesFiled': 'Filed',
  'report.minutesMissing': 'Not filed',
  'total.label': 'Total',

  'enum.memberStatus.ACTIVE': 'Active',
  'enum.memberStatus.INACTIVE': 'Inactive',
  'enum.memberStatus.SUSPENDED': 'Suspended',
  'enum.memberStatus.EXITED': 'Left the cooperative',
  'enum.memberPosition.MEMBER': 'Member',
  'enum.memberPosition.COMMITTEE': 'Committee',
  'enum.memberPosition.SECRETARY': 'Secretary',
  'enum.memberPosition.TREASURER': 'Treasurer',
  'enum.memberPosition.VICE_CHAIR': 'Vice chairperson',
  'enum.memberPosition.CHAIRPERSON': 'Chairperson',
  'enum.contributionType.MEMBERSHIP_FEE': 'Membership fee',
  'enum.contributionType.SAVINGS': 'Savings',
  'enum.contributionType.SHARE_CAPITAL': 'Share capital',
  'enum.contributionType.SPECIAL_LEVY': 'Special levy',
  'enum.contributionType.PENALTY': 'Penalty',
  'enum.contributionType.OTHER': 'Other contribution',
  'enum.shareType.PURCHASE': 'Bought',
  'enum.shareType.TRANSFER_IN': 'Received',
  'enum.shareType.TRANSFER_OUT': 'Passed on',
  'enum.shareType.REDEMPTION': 'Cashed in',
  'enum.paymentMethod.CASH': 'Cash',
  'enum.paymentMethod.MOBILE_MONEY': 'Mobile money',
  'enum.paymentMethod.BANK': 'Bank transfer',
  'enum.paymentMethod.CHEQUE': 'Cheque',
  'enum.paymentMethod.OTHER': 'Another way',
  'enum.paymentStatus.UNPAID': 'Unpaid',
  'enum.paymentStatus.PARTIAL': 'Part paid',
  'enum.paymentStatus.PAID': 'Paid',
  'enum.saleStatus.DRAFT': 'Draft',
  'enum.saleStatus.CONFIRMED': 'Confirmed',
  'enum.saleStatus.CANCELLED': 'Cancelled',
  'enum.financeKind.INCOME': 'Money in',
  'enum.financeKind.EXPENSE': 'Money out',
  'enum.postingStatus.POSTED': 'Recorded',
  'enum.postingStatus.VOID': 'Cancelled',
  'enum.inventoryType.RECEIPT': 'Received',
  'enum.inventoryType.ISSUE': 'Issued',
  'enum.inventoryType.ADJUSTMENT': 'Count corrected',
  'enum.inventoryType.TRANSFER_OUT': 'Moved out',
  'enum.inventoryType.TRANSFER_IN': 'Moved in',
  'enum.inventoryType.SALE_OUT': 'Sold',
  'enum.inventoryType.SALE_RETURN': 'Returned from a sale',
  'enum.inventoryType.OPENING': 'Opening count',
  'enum.meetingType.GENERAL_ASSEMBLY': 'General assembly',
  'enum.meetingType.BOARD': 'Board meeting',
  'enum.meetingType.COMMITTEE': 'Committee meeting',
  'enum.meetingType.EXTRAORDINARY': 'Extraordinary meeting',
  'enum.meetingType.OTHER': 'Other meeting',
  'enum.meetingStatus.SCHEDULED': 'Scheduled',
  'enum.meetingStatus.IN_PROGRESS': 'Under way',
  'enum.meetingStatus.COMPLETED': 'Completed',
  'enum.meetingStatus.CANCELLED': 'Cancelled',
  'enum.attendanceStatus.PRESENT': 'Present',
  'enum.attendanceStatus.ABSENT': 'Absent',
  'enum.attendanceStatus.EXCUSED': 'Excused',
  'enum.decisionType.RESOLUTION': 'Resolution',
  'enum.decisionType.ACTION': 'Action',
  'enum.decisionType.NOTE': 'Note',
  'enum.decisionStatus.OPEN': 'Open',
  'enum.decisionStatus.DONE': 'Done',
  'enum.decisionStatus.CANCELLED': 'Cancelled',
  'enum.documentCategory.REGISTRATION': 'Registration',
  'enum.documentCategory.FINANCIAL': 'Financial',
  'enum.documentCategory.MEMBER': 'Member',
  'enum.documentCategory.CONTRACT': 'Contract',
  'enum.documentCategory.CERTIFICATE': 'Certificate',
  'enum.documentCategory.MEETING_MINUTES': 'Meeting minutes',
  'enum.documentCategory.REPORT': 'Report',
  'enum.documentCategory.OTHER': 'Other',
  'enum.documentVisibility.COOPERATIVE': 'Cooperative',
  'enum.documentVisibility.RESTRICTED': 'Restricted',

  'action.auth.login.failed': 'Failed sign-in',
  'action.auth.login.succeeded': 'Signed in',
  'action.auth.logout': 'Signed out',
  'action.auth.refresh.reused': 'A used session token was presented again',
  'action.auth.session.revoked': 'Session ended',
  'action.catalogue.category.created': 'Product category added',
  'action.catalogue.category.updated': 'Product category changed',
  'action.catalogue.product.created': 'Product added',
  'action.catalogue.product.updated': 'Product changed',
  'action.catalogue.unit.created': 'Unit of measure added',
  'action.catalogue.unit.updated': 'Unit of measure changed',
  'action.catalogue.warehouse.created': 'Store added',
  'action.catalogue.warehouse.updated': 'Store changed',
  'action.cooperative.setting.updated': 'Setting changed',
  'action.cooperative.updated': 'Cooperative details changed',
  'action.document.uploaded': 'Document filed',
  'action.document.downloaded': 'Document read',
  'action.document.updated': 'Document details changed',
  'action.document.archived': 'Document archived',
  'action.document.restored': 'Document restored',
  'action.meeting.scheduled': 'Meeting scheduled',
  'action.meeting.updated': 'Meeting changed',
  'action.meeting.status.changed': 'Meeting state changed',
  'action.meeting.agenda.replaced': 'Agenda set',
  'action.meeting.attendance.recorded': 'Attendance recorded',
  'action.meeting.decision.recorded': 'Decision recorded',
  'action.meeting.decision.updated': 'Decision follow-up changed',
  'action.meeting.minutes.attached': 'Minutes attached',
  'action.finance.category.created': 'Money category added',
  'action.finance.category.updated': 'Money category changed',
  'action.finance.exported': 'Ledger exported',
  'action.finance.transaction.posted': 'Money entry recorded',
  'action.finance.transaction.updated': 'Money entry description changed',
  'action.finance.transaction.voided': 'Money entry cancelled',
  'action.inventory.adjusted': 'Stock corrected after a count',
  'action.inventory.issued': 'Stock went out',
  'action.inventory.received': 'Stock received',
  'action.inventory.reversed': 'Stock movement reversed',
  'action.inventory.transferred': 'Stock moved between stores',
  'action.inventory.valued': 'Stock valuation read',
  'action.member.contribution.recorded': 'Contribution recorded',
  'action.member.contribution.voided': 'Contribution cancelled',
  'action.member.created': 'Member registered',
  'action.member.exported': 'Register exported',
  'action.member.share.recorded': 'Shares recorded',
  'action.member.share.voided': 'Shares cancelled',
  'action.member.status.changed': 'Member state changed',
  'action.member.updated': 'Member details changed',
  'action.auth.passwordReset.requested': 'Password reset asked for',
  'action.auth.passwordReset.completed': 'Password reset finished',
  'action.staff.invited': 'Staff member invited',
  'action.staff.reactivated': 'Staff member brought back',
  'action.platform.cooperative.created': 'Cooperative created on the platform',
  'action.platform.cooperative.updated': 'Cooperative changed on the platform',
  'action.platform.user.created': 'Account created on the platform',
  'action.platform.user.updated': 'Account changed on the platform',
  'action.platform.setting.updated': 'Platform setting changed',
  'action.platform.tenant_access': 'A platform administrator opened this cooperative',
  'action.report.exported': 'Report produced',
  'action.sales.buyer.created': 'Buyer added',
  'action.sales.buyer.updated': 'Buyer changed',
  'action.sales.payment.recorded': 'Payment taken',
  'action.sales.receipt.issued': 'Receipt printed',
  'action.sales.sale.cancelled': 'Sale cancelled',
  'action.sales.sale.confirmed': 'Sale confirmed',
  'action.sales.sale.drafted': 'Sale started',
  'action.sales.sale.updated': 'Sale changed',
  'action.staff.deactivated': 'Staff member deactivated',
  'action.staff.overrides.replaced': 'Staff permissions changed',
  'action.staff.updated': 'Staff member changed',
  'action.user.password.changed': 'Password changed',
  'action.user.profile.updated': 'Profile changed',
  'action.unknown': 'Other action',
}

const RW: LabelBundle = {
  'report.monthly-cooperative': "Raporo y'ukwezi ya koperative",
  'report.financial': "Raporo y'imari",
  'report.member': "Raporo y'abanyamuryango",
  'report.inventory': "Raporo y'ububiko",
  'report.sales': "Raporo y'amagurisha",
  'report.activity': "Raporo y'ibikorwa",
  'report.meeting': "Raporo y'inyandikomvugo z'inama",

  'report.generatedBy': 'Yakozwe na {name}',
  'report.generatedAt': 'Yakozwe ku {when}',
  'report.period': 'Kuva {from} kugeza {to}',
  'report.page': 'Urupapuro {page}',
  'report.withheld': 'Igice cya {section} ntikigaragara, kuko uruhare rwawe ntirukibariyemo.',
  'report.unavailable': 'Iyi raporo isaba amakuru azaza mu cyiciro cya {phase}.',
  'report.none': 'Nta kintu cyanditswe muri iki gihe.',
  'report.unpriced':
    'Ibicuruzwa {count} ntibifite igiciro cyanditswe, bityo ntibibarirwa muri uyu mubare.',
  'report.truncated':
    'Hagaragara imirongo {shown} ya mbere kuri {total}. Kuramo raporo urebe iyindi yose.',

  'section.members': 'Abanyamuryango',
  'section.finance': 'Amafaranga',
  'section.inventory': 'Ububiko',
  'section.sales': 'Amagurisha',
  'section.contributions': 'Imisanzu',
  'section.shares': 'Imigabane',
  'section.valuation': "Agaciro k'ububiko",
  'section.categories': 'Ku byiciro',
  'section.movements': "Ibinyuranyo by'ububiko",
  'section.lowStock': 'Bigiye kurangira',
  'section.topBuyers': 'Abaguzi bakuru',
  'section.topProducts': 'Ibigurishwa cyane',
  'section.entries': 'Ibyanditswe byose',
  'section.register': "Urutonde rw'abanyamuryango",
  'section.activity': 'Ibyakozwe',
  'section.meetings': 'Inama',
  'section.decisions': "Ibyemezo n'ibikorwa",
  'section.attendance': 'Abitabiriye',

  'figure.members.total': 'Abanyamuryango',
  'figure.members.active': 'Abanyamuryango bakora',
  'figure.members.joined': 'Binjiye muri iki gihe',
  'figure.members.withoutPhone': 'Badafite telefone',
  'figure.finance.opening': 'Amafaranga yariho mu ntangiriro',
  'figure.finance.income': 'Amafaranga yinjiye',
  'figure.finance.expenses': 'Amafaranga yasohotse',
  'figure.finance.net': 'Itandukaniro',
  'figure.finance.closing': 'Amafaranga asigaye',
  'figure.inventory.products': 'Ibicuruzwa bibarwa',
  'figure.inventory.low': 'Ku gipimo ntarengwa cyangwa munsi yacyo',
  'figure.inventory.value': "Agaciro k'ububiko",
  'figure.inventory.received': 'Byakiriwe muri iki gihe',
  'figure.inventory.issued': 'Byasohotse muri iki gihe',
  'figure.sales.count': 'Amagurisha yemejwe',
  'figure.sales.sold': 'Byagurishijwe',
  'figure.sales.paid': 'Byishyuwe',
  'figure.sales.outstanding': 'Bisigaye kwishyurwa',
  'figure.contributions.count': 'Imisanzu',
  'figure.contributions.total': "Igiteranyo cy'imisanzu",
  'figure.shares.quantity': 'Imigabane ifitwe',
  'figure.shares.value': "Igishoro cy'imigabane",
  'figure.activity.entries': 'Ibikorwa byanditswe',
  'figure.meetings.held': 'Inama zabaye',
  'figure.meetings.cancelled': 'Inama zahagaritswe',
  'figure.meetings.decisions': 'Ibyemezo byafashwe',
  'figure.meetings.actionsOpen': 'Ibikorwa bikiri gukorwa',
  'figure.meetings.attendance': "Impuzandengo y'abitabiriye",

  'column.date': 'Itariki',
  'column.reference': 'Inomero',
  'column.kind': 'Ubwoko',
  'column.category': 'Icyiciro',
  'column.method': 'Uko byishyuwe',
  'column.description': 'Ibisobanuro',
  'column.amount': 'Amafaranga',
  'column.member': 'Umunyamuryango',
  'column.memberCode': "Inomero y'umunyamuryango",
  'column.phone': 'Telefone',
  'column.position': 'Inshingano',
  'column.status': 'Uko bihagaze',
  'column.joinedOn': 'Yinjiye',
  'column.product': 'Igicuruzwa',
  'column.sku': 'Inomero',
  'column.warehouse': 'Ububiko',
  'column.quantity': 'Ingano',
  'column.unit': 'Igipimo',
  'column.minimum': 'Gipimo ntarengwa',
  'column.value': 'Agaciro',
  'column.unitCost': 'Igiciro cya kimwe',
  'column.buyer': 'Umuguzi',
  'column.sales': 'Amagurisha',
  'column.total': 'Igiteranyo',
  'column.paid': 'Byishyuwe',
  'column.outstanding': 'Bisigaye',
  'column.who': 'Ninde',
  'column.what': 'Icyabaye',
  'column.share': 'Igipimo',
  'column.count': 'Umubare',
  'column.detail': 'Ibisobanuro',
  'column.meeting': 'Inama',
  'column.attendees': 'Abitabiriye',
  'column.quorum': 'Umubare wa ngombwa',
  'column.decision': 'Icyemezo',
  'column.votes': 'Bemeje / Banze / Birengagije',
  'column.responsible': 'Ushinzwe',
  'column.due': 'Itariki ntarengwa',
  'column.minutes': 'Inyandikomvugo',

  'report.quorumMet': 'Wujujwe',
  'report.quorumNotMet': 'Ntiwujujwe',
  'report.quorumNone': 'Ntawashyizwe',
  'report.minutesFiled': 'Yashyinguwe',
  'report.minutesMissing': 'Ntiyashyinguwe',
  'total.label': 'Igiteranyo',

  'enum.memberStatus.ACTIVE': 'Akora',
  'enum.memberStatus.INACTIVE': 'Ntakora',
  'enum.memberStatus.SUSPENDED': 'Yahagaritswe',
  'enum.memberStatus.EXITED': 'Yavuye mu koperative',
  'enum.memberPosition.MEMBER': 'Umunyamuryango',
  'enum.memberPosition.COMMITTEE': 'Komite',
  'enum.memberPosition.SECRETARY': 'Umunyamabanga',
  'enum.memberPosition.TREASURER': 'Umubitsi',
  'enum.memberPosition.VICE_CHAIR': 'Visi perezida',
  'enum.memberPosition.CHAIRPERSON': 'Perezida wa koperative',
  'enum.contributionType.MEMBERSHIP_FEE': 'Amafaranga yo kwinjira',
  'enum.contributionType.SAVINGS': 'Ubwizigame',
  'enum.contributionType.SHARE_CAPITAL': "Imigabane y'igishoro",
  'enum.contributionType.SPECIAL_LEVY': 'Umusanzu wihariye',
  'enum.contributionType.PENALTY': 'Ihazabu',
  'enum.contributionType.OTHER': 'Undi musanzu',
  'enum.shareType.PURCHASE': 'Yaguze',
  'enum.shareType.TRANSFER_IN': 'Yahawe',
  'enum.shareType.TRANSFER_OUT': 'Yatanze',
  'enum.shareType.REDEMPTION': 'Yagurishije',
  'enum.paymentMethod.CASH': 'Amafaranga mu ntoki',
  'enum.paymentMethod.MOBILE_MONEY': 'Kuri Mobile money',
  'enum.paymentMethod.BANK': 'Kwohereza kuri banki',
  'enum.paymentMethod.CHEQUE': 'Sheki',
  'enum.paymentMethod.OTHER': 'Ubundi buryo',
  'enum.paymentStatus.UNPAID': 'Ntibyishyuwe',
  'enum.paymentStatus.PARTIAL': 'Byishyuwe igice',
  'enum.paymentStatus.PAID': 'Byishyuwe',
  'enum.saleStatus.DRAFT': 'Umushinga',
  'enum.saleStatus.CONFIRMED': 'Ryemejwe',
  'enum.saleStatus.CANCELLED': 'Ryahagaritswe',
  'enum.financeKind.INCOME': 'Amafaranga yinjiye',
  'enum.financeKind.EXPENSE': 'Amafaranga yasohotse',
  'enum.postingStatus.POSTED': 'Byanditswe',
  'enum.postingStatus.VOID': 'Byahagaritswe',
  'enum.inventoryType.RECEIPT': 'Byakiriwe',
  'enum.inventoryType.ISSUE': 'Byasohotse',
  'enum.inventoryType.ADJUSTMENT': 'Ibarura ryakosowe',
  'enum.inventoryType.TRANSFER_OUT': 'Byimuwe bisohoka',
  'enum.inventoryType.TRANSFER_IN': 'Byimuwe binjira',
  'enum.inventoryType.SALE_OUT': 'Byagurishijwe',
  'enum.inventoryType.SALE_RETURN': "Byasubijwe nyuma y'igurisha",
  'enum.inventoryType.OPENING': "Ibarura ry'itangiriro",
  'enum.meetingType.GENERAL_ASSEMBLY': 'Inteko rusange',
  'enum.meetingType.BOARD': "Inama y'ubuyobozi",
  'enum.meetingType.COMMITTEE': 'Inama ya komite',
  'enum.meetingType.EXTRAORDINARY': 'Inama idasanzwe',
  'enum.meetingType.OTHER': 'Indi nama',
  'enum.meetingStatus.SCHEDULED': 'Yateganyijwe',
  'enum.meetingStatus.IN_PROGRESS': 'Iragenda',
  'enum.meetingStatus.COMPLETED': 'Yarangiye',
  'enum.meetingStatus.CANCELLED': 'Yahagaritswe',
  'enum.attendanceStatus.PRESENT': 'Yitabiriye',
  'enum.attendanceStatus.ABSENT': 'Ntiyitabiriye',
  'enum.attendanceStatus.EXCUSED': 'Yasabye uruhushya',
  'enum.decisionType.RESOLUTION': 'Umwanzuro',
  'enum.decisionType.ACTION': 'Igikorwa',
  'enum.decisionType.NOTE': 'Icyitonderwa',
  'enum.decisionStatus.OPEN': 'Kirakomeje',
  'enum.decisionStatus.DONE': 'Cyakozwe',
  'enum.decisionStatus.CANCELLED': 'Cyahagaritswe',
  'enum.documentCategory.REGISTRATION': 'Iyandikwa',
  'enum.documentCategory.FINANCIAL': "Iy'imari",
  'enum.documentCategory.MEMBER': "Iy'umunyamuryango",
  'enum.documentCategory.CONTRACT': 'Amasezerano',
  'enum.documentCategory.CERTIFICATE': 'Icyemezo',
  'enum.documentCategory.MEETING_MINUTES': "Inyandikomvugo y'inama",
  'enum.documentCategory.REPORT': 'Raporo',
  'enum.documentCategory.OTHER': 'Izindi',
  'enum.documentVisibility.COOPERATIVE': 'Koperative',
  'enum.documentVisibility.RESTRICTED': 'Ifite aho igarukira',

  'action.auth.login.failed': 'Kwinjira byanze',
  'action.auth.login.succeeded': 'Yinjiye',
  'action.auth.logout': 'Yasohotse',
  'action.auth.refresh.reused': 'Ikimenyetso cyakoreshejwe cyongeye kugaragazwa',
  'action.auth.session.revoked': 'Umwanya wo kwinjira warangiye',
  'action.catalogue.category.created': "Icyiciro cy'ibicuruzwa cyongewemo",
  'action.catalogue.category.updated': "Icyiciro cy'ibicuruzwa cyahinduwe",
  'action.catalogue.product.created': 'Igicuruzwa cyongewemo',
  'action.catalogue.product.updated': 'Igicuruzwa cyahinduwe',
  'action.catalogue.unit.created': 'Igipimo cyongewemo',
  'action.catalogue.unit.updated': 'Igipimo cyahinduwe',
  'action.catalogue.warehouse.created': 'Ububiko bwongewemo',
  'action.catalogue.warehouse.updated': 'Ububiko bwahinduwe',
  'action.cooperative.setting.updated': 'Igenamiterere ryahinduwe',
  'action.cooperative.updated': 'Amakuru ya koperative yahinduwe',
  'action.document.uploaded': 'Inyandiko yashyinguwe',
  'action.document.downloaded': 'Inyandiko yasomwe',
  'action.document.updated': "Amakuru y'inyandiko yahinduwe",
  'action.document.archived': 'Inyandiko yabitswe mu bubiko',
  'action.document.restored': 'Inyandiko yagaruwe',
  'action.meeting.scheduled': 'Inama yateganyijwe',
  'action.meeting.updated': 'Inama yahinduwe',
  'action.meeting.status.changed': 'Uko inama ihagaze byahindutse',
  'action.meeting.agenda.replaced': "Ingingo z'inama zashyizweho",
  'action.meeting.attendance.recorded': 'Abitabiriye banditswe',
  'action.meeting.decision.recorded': 'Icyemezo cyanditswe',
  'action.meeting.decision.updated': 'Ibikurikira icyemezo byahinduwe',
  'action.meeting.minutes.attached': 'Inyandikomvugo yashyizweho',
  'action.finance.category.created': "Icyiciro cy'amafaranga cyongewemo",
  'action.finance.category.updated': "Icyiciro cy'amafaranga cyahinduwe",
  'action.finance.exported': "Ibitabo by'imari byakuwemo",
  'action.finance.transaction.posted': 'Amafaranga yanditswe',
  'action.finance.transaction.updated': "Ibisobanuro by'amafaranga byahinduwe",
  'action.finance.transaction.voided': 'Amafaranga yanditswe yakuweho',
  'action.inventory.adjusted': 'Ububiko bwakosowe nyuma yo kubara',
  'action.inventory.issued': 'Ibicuruzwa byasohotse',
  'action.inventory.received': 'Ibicuruzwa byakiriwe',
  'action.inventory.reversed': "Ikinyuranyo cy'ububiko cyasubijwe",
  'action.inventory.transferred': "Ibicuruzwa byimuwe hagati y'ububiko",
  'action.inventory.valued': "Agaciro k'ububiko kasomwe",
  'action.member.contribution.recorded': 'Umusanzu wanditswe',
  'action.member.contribution.voided': 'Umusanzu wakuweho',
  'action.member.created': 'Umunyamuryango wanditswe',
  'action.member.exported': "Urutonde rw'abanyamuryango rwakuwemo",
  'action.member.share.recorded': 'Imigabane yanditswe',
  'action.member.share.voided': 'Imigabane yakuweho',
  'action.member.status.changed': 'Uko umunyamuryango ahagaze byahindutse',
  'action.member.updated': "Amakuru y'umunyamuryango yahinduwe",
  'action.auth.passwordReset.requested': 'Guhindura ijambobanga byasabwe',
  'action.auth.passwordReset.completed': 'Guhindura ijambobanga byarangiye',
  'action.staff.invited': 'Umukozi yatumiwe',
  'action.staff.reactivated': 'Umukozi yagaruwe mu mirimo',
  'action.platform.cooperative.created': 'Koperative yashyizwe kuri sisitemu',
  'action.platform.cooperative.updated': 'Koperative yahinduwe kuri sisitemu',
  'action.platform.user.created': 'Konti yashyizwe kuri sisitemu',
  'action.platform.user.updated': 'Konti yahinduwe kuri sisitemu',
  'action.platform.setting.updated': 'Igenamiterere rya sisitemu ryahinduwe',
  'action.platform.tenant_access': 'Umuyobozi wa sisitemu yasuye iyi koperative',
  'action.report.exported': 'Raporo yakozwe',
  'action.sales.buyer.created': 'Umuguzi yongewemo',
  'action.sales.buyer.updated': 'Umuguzi yahinduwe',
  'action.sales.payment.recorded': 'Ubwishyu bwakiriwe',
  'action.sales.receipt.issued': 'Inyemezabwishyu yacapwe',
  'action.sales.sale.cancelled': 'Igurisha ryahagaritswe',
  'action.sales.sale.confirmed': 'Igurisha ryemejwe',
  'action.sales.sale.drafted': 'Igurisha ryatangijwe',
  'action.sales.sale.updated': 'Igurisha ryahinduwe',
  'action.staff.deactivated': 'Umukozi yahagaritswe',
  'action.staff.overrides.replaced': "Uburenganzira bw'umukozi bwahinduwe",
  'action.staff.updated': 'Umukozi yahinduwe',
  'action.user.password.changed': 'Ijambobanga ryahinduwe',
  'action.user.profile.updated': 'Umwirondoro wahinduwe',
  'action.unknown': 'Ikindi gikorwa',
}

export const REPORT_LABELS: Readonly<Record<Locale, LabelBundle>> = { EN, RW }

/**
 * Reads a label, substituting `{name}` style placeholders.
 *
 * Deliberately not i18next: this has to run on the server, where no i18next instance exists, and
 * the substitution a report needs is one value into one sentence. A missing key returns itself,
 * which is loud enough to notice in a test and harmless enough not to break a printed page.
 */
export function reportLabel(
  locale: Locale,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const bundle = REPORT_LABELS[locale] ?? EN
  const template = bundle[key] ?? EN[key] ?? key
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  )
}

/**
 * The name of an audit action, in words.
 *
 * The activity report is read by a cooperative's auditors and filed, so it cannot print
 * `finance.transaction.voided` and leave a reader to guess. An action with no label falls back to
 * "Other action" rather than printing the code: a page that says a little less is better than one
 * that says something nobody can read. `apps/backend/test/reports.test.ts` fails the build when
 * the backend writes an action this catalogue does not name, so the fallback should never be
 * reached in practice.
 */
export function auditActionLabel(locale: Locale, action: string): string {
  return hasAuditActionLabel(action)
    ? reportLabel(locale, `action.${action}`)
    : reportLabel(locale, 'action.unknown')
}

export function hasAuditActionLabel(action: string): boolean {
  return `action.${action}` in REPORT_LABELS.EN
}

/**
 * A database enum value in words.
 *
 * Reports print these into table cells, so an unknown value returns the raw code rather than an
 * empty cell: a page that shows `SUSPENDED` is odd, and a page with a blank where a member's state
 * should be is misleading. The backend's report test asserts every value of every enum a report
 * prints has a label here, so the fallback should not be reached.
 */
export function enumLabel(locale: Locale, group: string, value: string | null): string {
  if (!value) return ''
  const key = `enum.${group}.${value}`
  return key in REPORT_LABELS.EN ? reportLabel(locale, key) : value
}
