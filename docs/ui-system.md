# CoopManage Rwanda — Design System

Status: **Phase 0 baseline.** Implemented as Tailwind tokens and primitives in Phase 1, refined in
Phase 16.

---

## 1. Design direction

The product is a working tool used every day by a cooperative secretary with a stack of paper
receipts beside the keyboard. It should feel like a well-made ledger: **calm, dense, legible,
unsurprising.** Closer to a bank's back-office system or a good accounting package than to a
marketing dashboard.

Five words guide every decision: **Trust, Simplicity, Professionalism, Efficiency, Rwanda.**

"Rwanda" is expressed through a deep green drawn from the country's landscape, an earth-toned
accent, Kinyarwanda as a first-class language, RWF as the native currency, and the provincial and
district hierarchy in every address field. It is **not** expressed by putting the flag's four
colours into the interface.

### Explicitly rejected

Gradients in the interface chrome. Neon or saturated colour. Glassmorphism. Rounded corners above
8 px. Drop shadows on static content. Decorative illustrations. Oversized headings. Icon-in-a-tinted-circle
tiles. Grids of near-identical cards. Charts that answer no question. Animated counters. Emoji as
interface iconography. Purple.

---

## 2. Colour

Tailwind CSS v4 is configured in CSS, not in a JavaScript config file. Every token below is
declared once inside an `@theme` block in `src/styles/theme.css`, which makes it available both as
a Tailwind utility (`bg-surface`, `text-primary`) and as a CSS custom property for the few places
that need one directly. Nothing in a component uses a raw hex value.

### Neutral (surfaces and text)

Warm-neutral grey with a faint green undertone, so it sits with the primary rather than fighting it.

| Token | Hex | Use |
| --- | --- | --- |
| `--surface` | `#FFFFFF` | Cards, tables, dialogs, inputs |
| `--surface-sunken` | `#F6F8F7` | Application background |
| `--surface-subtle` | `#EFF2F1` | Table header, hover row, disabled fill |
| `--border` | `#E6EAE8` | Default 1 px separators |
| `--border-strong` | `#D8DEDB` | Input borders, table outer edge |
| `--text-primary` | `#101413` | Body copy, figures |
| `--text-secondary` | `#4A5551` | Labels, secondary cells |
| `--text-muted` | `#67736F` | Hints, timestamps, placeholders |
| `--text-disabled` | `#8B9793` | Disabled control text |

### Primary — "Amashyamba" green

| Step | Hex | Use |
| --- | --- | --- |
| 50 | `#ECF5F0` | Selected row, subtle tint |
| 100 | `#D3E8DD` | Badge background |
| 200 | `#A8D2BC` | Chart fill, sparkline area |
| 400 | `#429676` | Chart series, hover accents |
| 600 | `#12634A` | **Primary buttons, links, active nav, focus ring** |
| 700 | `#0D4F3B` | Button hover, pressed |
| 800 | `#0A3E2F` | Sidebar background |
| 900 | `#072B21` | Sidebar deep areas, print headers |

### Accent — clay

Used sparingly: the second chart series, member-related highlights, the demonstration-data badge.
Never for primary actions.

| Token | Hex |
| --- | --- |
| `--accent-100` | `#F6E7DC` |
| `--accent-500` | `#B4622C` |
| `--accent-600` | `#97501F` |

### Semantic

Each has a foreground, a background and a border so alerts and badges need no opacity tricks.

| Meaning | Foreground | Background | Border |
| --- | --- | --- | --- |
| Success / money in | `#0F6B3E` | `#E8F5ED` | `#B7E0C7` |
| Warning / watch | `#8A5606` | `#FDF3E2` | `#F0D9A8` |
| Danger / money out | `#A4271D` | `#FDECEA` | `#F3C3BD` |
| Info / neutral notice | `#14509B` | `#EAF1FE` | `#C3D8F8` |

Income green and expense red are the **only** places colour carries financial direction, and both
always appear alongside a sign or a word, never alone.

### Chart palette

Muted, distinguishable in the common forms of colour blindness, and readable when printed grey.

```
#12634A  #B4622C  #2E5EA8  #7A8B34  #8A5FA8  #A03B52  #4E7C8C  #86713C
```

Sequential ramps derive from primary. Charts use at most six series; beyond that the data is
grouped into "Other".

### Dark mode

Light mode is the product. A dark theme is scoped as optional polish in Phase 16: tokens are already
structured so a `[data-theme="dark"]` block redefines them with no component changes. It ships only
if it can be done properly, including charts, print and status colours.

---

## 3. Typography

One family: **Inter Variable**, self-hosted through `@fontsource-variable/inter`, with a system
fallback stack. No second display face.

All figures use `font-variant-numeric: tabular-nums` so columns of money align. This is applied
globally to table cells, statistic tiles and the `<Money>` component.

| Role | Size / line | Weight | Tracking |
| --- | --- | --- | --- |
| Page title | 20 / 28 | 600 | −0.01em |
| Section heading | 16 / 24 | 600 | 0 |
| Card title | 14 / 20 | 600 | 0 |
| Body | 14 / 20 | 400 | 0 |
| Body small, table cell secondary | 13 / 18 | 400 | 0 |
| Form label | 13 / 18 | 500 | 0 |
| Table column header | 12 / 16 | 600 | 0.04em, uppercase |
| Caption, hint, timestamp | 12 / 16 | 400 | 0 |
| Statistic figure | 24 / 30 | 600 | −0.02em, tabular |
| Large statistic (dashboard hero) | 30 / 36 | 600 | −0.02em, tabular |

Base size is 14 px, not 16 px: this is a dense data application and 14 px is the size at which a
table of twenty rows and eight columns stays readable without scrolling. Body text in long-form
areas such as meeting minutes and announcements steps up to 15 px with a 65-character measure.

---

## 4. Spacing, radius, elevation

Spacing is a 4 px grid: `4 8 12 16 20 24 32 40 48 64`. Page gutter 24 px on desktop, 16 px on
mobile. Vertical rhythm between page sections is 24 px; inside a panel, 16 px.

| Radius | Value | Applied to |
| --- | --- | --- |
| `sm` | 4 px | Badges, checkboxes, small buttons |
| `md` | 6 px | Buttons, inputs, selects |
| `lg` | 8 px | Panels, cards, dialogs, popovers |

Nothing is more rounded than 8 px, except avatars, which are circular.

Elevation is used only for content that floats above the page: dropdowns, popovers, dialogs, toasts.
Static panels are defined by a 1 px border, never a shadow.

```
--shadow-overlay: 0 8px 24px -6px rgb(16 20 19 / 0.14), 0 2px 6px -2px rgb(16 20 19 / 0.08);
--shadow-sticky:  0 1px 0 0 var(--border), 0 4px 8px -6px rgb(16 20 19 / 0.10);
```

---

## 5. Layout

```
┌──────────┬──────────────────────────────────────────────────┐
│          │ Top bar 56px  cooperative · search · lang · user  │
│ Sidebar  ├──────────────────────────────────────────────────┤
│  248px   │ Page header  title · description · page actions   │
│          ├──────────────────────────────────────────────────┤
│ nav      │                                                   │
│ groups   │ Content   max-width 1440, gutter 24               │
│          │                                                   │
└──────────┴──────────────────────────────────────────────────┘
```

The sidebar sits on `--primary-800` with white text, grouped as: **Overview** (Dashboard, Ask CoopManage, Reports),
**Cooperative** (Members, Contributions, Meetings, Documents, Announcements), **Operations**
(Inventory, Products, Sales, Buyers), **Money** (Finance), **Administration** (Staff, Settings,
Audit). Items the user lacks permission for are not rendered, and an empty group disappears.

The top bar carries the cooperative switcher (only when the user serves more than one), global
search, the language switcher, the connection indicator, notifications and the user menu.

**Responsive.** Three intentional layouts rather than one shrinking layout.

| Breakpoint | Layout |
| --- | --- |
| ≥ 1280 px | Full sidebar, multi-column forms, full tables |
| 768–1279 px | Sidebar collapses to a 64 px icon rail; forms go to one column; tables drop low-priority columns |
| < 768 px | Sidebar becomes an off-canvas drawer; tables become stacked record cards with the two or three fields that matter; primary action becomes a fixed bottom bar |

Tables are never horizontally scrolled on a phone. Each list defines its mobile card shape
explicitly: for members that is name, member code and status; for transactions it is description,
amount and date.

---

## 6. Component inventory

Primitives in `components/ui/`, composed patterns in `components/`. Built on Radix UI for the
behaviour that is genuinely hard to get right (dialog, dropdown, popover, tabs, tooltip, select),
styled entirely by our own tokens. One icon library: **lucide-react**, 16 px in dense contexts,
18 px in navigation, `stroke-width: 1.75`. No other icon set.

| Component | Specification |
| --- | --- |
| `Button` | Variants `primary`, `secondary`, `ghost`, `danger`, `link`. Heights 32 / 36 / 40. Loading state replaces the leading icon with a spinner, keeps the label, and disables the control |
| `IconButton` | Square, 32 / 36. Requires `aria-label` |
| `Input` `Textarea` `Select` | 36 px height, 1 px `--border-strong`, 6 px radius, 12 px inset. On focus the border becomes `--primary-600`, in addition to the standard focus ring |
| `Combobox` | Type-ahead over server-searched options. Used for member, product and buyer pickers |
| `DatePicker` / `DateRangePicker` | Text entry plus calendar. Presets: today, this week, this month, last month, this quarter, this year, custom |
| `FormField` | Label, optional hint, control, error. Error is red text with an icon and is bound by `aria-describedby` |
| `MoneyInput` | Thousands separators as you type, "RWF" suffix, emits a decimal string |
| `QuantityInput` | Number plus unit label taken from the product |
| `DataTable` | Sticky header, sortable columns, per-column alignment (money and quantities right), row hover, selectable rows, empty state, loading skeleton, pagination footer, density toggle. Row 44 px, compact 36 px |
| `Panel` | Bordered surface with optional header, description and actions. The default container |
| `StatTile` | Label, figure, optional comparison with direction word plus arrow, optional sparkline. No icon in a coloured circle |
| `Badge` | `neutral`, `success`, `warning`, `danger`, `info`, `accent`. Text plus a 6 px dot, so meaning never rests on colour |
| `Alert` | Inline, four semantic variants, optional action |
| `Dialog` | Radix, focus trapped, Escape closes, labelled by its title, 480 / 640 / 800 px widths |
| `ConfirmDialog` | Titled question, consequence sentence, typed confirmation for high-value financial actions |
| `Drawer` | Right-side panel for record detail without losing list context |
| `Toast` | Bottom-right, four seconds, action link, screen-reader live region |
| `EmptyState` | Heading, one explanatory sentence, primary action. Small line icon, never an illustration |
| `Skeleton` | Shape-matched placeholders for table rows, tiles and detail panels |
| `Pagination` | Range summary, page size selector, first / previous / next / last |
| `Tabs`, `Breadcrumb`, `Tooltip`, `DropdownMenu`, `Switch`, `Checkbox`, `Radio`, `Avatar`, `Progress` | Standard, token-styled |
| `Money` | Formats a decimal string. `250,000 RWF` |
| `DateDisplay` | Locale-aware, with the absolute date in a tooltip when a relative form is shown |
| `PermissionGate` | Renders children only when the permission is held |
| `ConnectionIndicator` | Online, reconnecting or offline, with plain-language text |

### Money formatting

Rwandan francs have no circulating subunit, so amounts display as whole francs with thousands
separators and a trailing currency code: `250,000 RWF`. Decimals appear only where a stored value is
not whole. Storage remains `numeric(14,2)`; this is a display rule. Quantities show the product's
unit and its configured precision: `1,240.5 kg`, `150 units`.

---

## 7. Table and form patterns

**Tables** are the core of the product and get the most attention.

- Column order follows reading priority: identity, then status, then figures, then date, then a
  right-aligned actions column.
- Money and quantities are right-aligned and tabular. Text is left-aligned. Status badges are
  left-aligned in their own column.
- Header row: `--surface-subtle`, 12 px uppercase labels, sticky under the page header.
- Row hover tints to `--primary-50`. The whole row is a link to the detail view where one exists.
- Filters live in a toolbar above the table: a search field, two or three of the most useful
  filters inline, and everything else behind a "Filters" button that shows a count when active.
  Active filters render as removable chips. Filter state lives in the URL, so a filtered view can be
  bookmarked and shared.
- Totals, where meaningful, sit in a footer row that reflects the current filter, and the table says
  whether the total covers the page or the whole filtered set.
- Bulk selection appears only where a bulk action genuinely exists.

**Forms.**

- One column by default. Two columns only for genuinely paired fields such as first and last name,
  or province and district.
- Labels sit above controls, always visible. Placeholders are examples, never labels.
- Required is the default; **optional fields are marked "(optional)"**. This matters here because
  the phone field must read as clearly optional.
- Validation runs on blur and again on submit, never on every keystroke. Errors appear beneath the
  field and the first invalid field receives focus. A summary at the top of long forms lists them.
- The submit button states the action: "Record expense", not "Submit". While saving it shows a
  spinner and the form is locked.
- Long forms save a draft to local storage under a stable key and restore it with a dismissible
  notice.
- Every form is completable by keyboard alone, and Enter submits from any single-line field.

**Quick actions** appear as a row of labelled buttons directly under the dashboard page header and
in the top bar as a "New" menu. Each opens a focused dialog, not a new page, with the shortest
possible field set and sensible defaults: today's date, the default warehouse, the last used
category. Recording an expense should take under fifteen seconds.

---

## 8. Feedback states

Every list, panel and page defines four states, and none of them is a blank screen.

| State | Treatment |
| --- | --- |
| Loading | Shape-matched skeletons. Never a centred spinner on a full page after first load |
| Empty (no data yet) | Heading, one sentence of guidance, primary action. "No members yet. Add your first cooperative member to start building your records." |
| Empty (no results for filters) | Different message, plus a "Clear filters" action. Never confused with the first case |
| Error | Plain sentence about what failed and what to do, plus "Try again". Technical detail behind a disclosure for support, never in the main message |

Error copy names the action and the remedy: "We could not save this expense. Check your connection
and try again." Never a bare status code.

Confirmation is reserved for actions that are hard to undo. Deactivating a member, voiding a
transaction, cancelling a confirmed sale and archiving a document are confirmed. Saving a draft or
applying a filter is not. Financial confirmations restate the amount: "Confirm expense of
250,000 RWF for transport."

---

## 9. Accessibility

Targeting WCAG 2.1 AA, checked with axe in the component test suite and by keyboard walkthrough at
the end of every phase.

- Body text meets 4.5:1 and large text 3:1 against its background. Every token pair in this document
  has been chosen against that threshold.
- Visible focus everywhere and identical on every control: a 2 px `--primary-600` ring at a 2 px
  offset, applied on `:focus-visible` and never removed. Inputs additionally recolour their border,
  which is an addition to the ring, never a replacement for it.
- Semantic HTML: real `<table>`, `<th scope>`, `<button>`, `<nav>`, `<main>`, one `<h1>` per page and
  no skipped heading levels.
- Dialogs trap focus, close on Escape, restore focus to the trigger and are labelled by their title.
- Form controls have real labels; errors are announced through `aria-live` and linked by
  `aria-describedby`.
- Status is never conveyed by colour alone: badges pair a dot with a word, charts label series
  directly, and financial direction is shown with a sign.
- A skip link precedes the sidebar. Icon-only controls carry `aria-label`.
- Keyboard shortcuts: `/` focuses search, `g` then a letter navigates, `n` opens the new-record menu,
  `?` lists the shortcuts. All are discoverable and none conflicts with a screen reader.

---

## 10. Charts

A chart earns its place only by answering a question a manager actually asks. Phase 10 ships three
charts and one list:

| Question | Chart |
| --- | --- |
| Is money coming in faster than it goes out? | Twelve-month income against expenses, grouped bars |
| Are we selling more or less than before? | Six-month sales value, line with the previous period ghosted |
| Where does the money go? | Expenses by category for the period, horizontal bars, top six then "Other" |
| Is any product about to run out? | Deliberately not a chart. A list of products below their minimum, with the quantity left |

Rules: direct labels rather than a legend where there are three or fewer series; axes start at zero
for bars; no pie chart above three slices; no dual axes; no animation beyond a 150 ms fade on load;
every chart has a table equivalent reachable in one click, which is also what screen readers get.

---

## 11. Print and export

Reports are designed for A4 paper, because a Rwandan cooperative's general assembly runs on printed
documents.

A print stylesheet removes the shell, sets black text on white, converts status badges to text,
repeats table headers across pages, and prints a footer with the cooperative name, the report title,
the period, the generation timestamp, the generating user and a page number. Generated PDFs use the
same layout so the screen preview matches the paper exactly.

---

## 12. Language and content

Interface English is plain and direct: "Record expense", "Add member", "Money in". No jargon, no
exclamation marks, no cleverness. Sentence case for every label, heading and button; title case
never.

Kinyarwanda is a first-class language, not a translation layer. Practical consequences for the
design:

- Kinyarwanda labels commonly run 20–40 % longer than English. No button, tab, column header or
  navigation item may have a fixed width, and every layout is reviewed in Kinyarwanda before a phase
  closes.
- A shared glossary in `docs/glossary.md` fixes the terminology once — member (*umunyamuryango*),
  cooperative (*koperative*), income (*amafaranga yinjiye*), expenses (*amafaranga yasohotse*),
  balance (*amafaranga asigaye*), stock (*ububiko*), sale (*igurisha*), meeting (*inama*) — so the
  same concept is never named two ways in two screens.
- Where a precise Kinyarwanda accounting term would be unfamiliar to a rural cooperative secretary,
  the simpler and more widely understood wording wins.
- Dates, numbers and currency are formatted through `Intl` with the active locale.
