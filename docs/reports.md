# CoopManage Rwanda — Reports

Status: **Phase 8 complete**, with the minutes report added in Phase 9 alongside the meetings it
reads. Seven report types, previewed on screen and produced as PDF, CSV or a spreadsheet.

---

## 1. What a report is here

A report is **one structure rendered four ways**.

`packages/shared/src/reports.ts` defines a `ReportDocument`: a header, an ordered list of sections,
and a footer. A section is a row of headline figures, a table, a note, or a statement that a section
was withheld. `apps/backend/src/modules/reports/reports.data.ts` builds that structure from the
member, finance, inventory, sales and audit records. Four renderers walk it:

| Renderer                          | Output                      |
| --------------------------------- | --------------------------- |
| `ReportView.tsx` (frontend)       | the screen                  |
| `render.pdf.ts` (backend, pdfkit) | A4 paper                    |
| `render.csv.ts`                   | a CSV a spreadsheet can sum |
| `render.xlsx.ts`                  | a real workbook             |

Nothing in a renderer decides what a report says. That is the whole point: a cooperative that reads
one figure out at a general assembly and finds a different one on the ledger screen the next morning
has lost the use of both.

**Values are held raw and formatted at the point of rendering.** Money is a decimal string,
quantities are decimal strings, dates are `YYYY-MM-DD`. Every renderer formats through
`formatReportValue`, so the screen and the paper cannot differ; the CSV writes the raw value because
`1,210,000` inside a CSV cell arrives as text; and the spreadsheet writes a real number with a
currency format, because the first thing anybody does with that file is select a column and read the
sum.

---

## 2. The seven reports

| Type                  | Needs            | Sections                                                             |
| --------------------- | ---------------- | -------------------------------------------------------------------- |
| `monthly-cooperative` | `reports:view`   | membership, money, by category, stock, running low, sales, most sold |
| `financial`           | `finance:view`   | money, by category, every entry                                      |
| `member`              | `members:view`   | the register, or one member with contributions and shares            |
| `inventory`           | `inventory:view` | figures, holdings, running low, movements                            |
| `sales`               | `sales:view`     | figures, most sold, biggest buyers, every sale                       |
| `activity`            | `audit:view`     | what was done, in words                                              |
| `meeting`             | `meetings:view`  | **Phase 9.** Refuses with the phase that brings it.                  |

The monthly cooperative report is the one that matters and the reason the others exist: it is what a
committee reads out at a general assembly, it is assembled from every module, and its section order
follows a Rwandan cooperative's agenda — membership, money, stock, sales.

---

## 3. Permissions

Three layers, all enforced on the server.

**The route.** `reports:view` opens the catalogue and a preview. `reports:export` produces a file.
These are separate because reading a report and producing a document that leaves the cooperative and
is filed elsewhere are different acts.

**The report.** Each report additionally requires the permission covering its own data, checked in
`buildReport`. A secretary holds `reports:view` and `reports:export` but not `finance:view`, so the
financial report is refused to them with `403`.

**The section.** Inside a report, each section is gated by the permission covering that section's
data. A section the reader may not see is **named on the page** — "The Money section is not shown,
because your role does not cover it" — and listed once at the top, never dropped. A section that
quietly disappeared is one somebody draws a conclusion from.

A download re-checks the report's permission rather than trusting it from when the run was first
produced, so a link to an old run is not a way round a role that has since been narrowed.

---

## 4. Endpoints

| Method | Path                         | Access           |
| ------ | ---------------------------- | ---------------- |
| GET    | `/reports`                   | `reports:view`   |
| GET    | `/reports/runs`              | `reports:view`   |
| GET    | `/reports/runs/:id/download` | `reports:export` |
| POST   | `/reports/:type/preview`     | `reports:view`   |
| POST   | `/reports/:type/export`      | `reports:export` |

A preview is a `POST` although it reads nothing: its parameters are a body rather than a query
string, which keeps a member's identifier out of server logs and browser history. The period is
required rather than defaulted — a report whose dates were guessed is a report somebody reads the
wrong month out of.

`/reports/runs` is registered before `/reports/:type/...`, so "runs" is not read as a report type.

An export answers with the file as an attachment, named `<code>-<report>-<from>-to-<to>.<ext>`, and
carries the run's identifier in `X-Report-Run-Id`.

---

## 5. Report runs

Every export writes a `report_runs` row before the work starts: the type, the parameters exactly as
validated, the format, who asked, and how it ended. A run that fails leaves a row saying why, which
is the whole reason the row is inserted first — inserting on success loses exactly the runs somebody
needs to ask about. Three check constraints hold the states honest: a failed run has a reason, a
ready run has a completion time, and a row count is not negative.

A `REPORT_READY` notification is raised to **the person who asked**, not to every member of staff.
Everyone being told about everyone else's reports is how a cooperative learns to ignore its
notifications.

### The deliberate deviation

`storage_key` is null and a download **produces the report again from its stored parameters** rather
than serving a kept copy. There is no file storage until Phase 9.

The consequence is worth stating plainly: a correction posted since the run will appear in the
reproduced file, so two downloads of the same run can differ. For a cooperative that is the better
behaviour — a re-download still carrying a figure since corrected would be the surprise — but it is
not what "download again" means elsewhere. When Phase 9 brings storage, `storage_key` is where the
kept bytes go and the original file becomes available alongside the reproduction.

---

## 6. The PDF

pdfkit, not a headless browser. A browser would have let the print stylesheet do the work, but it
also means shipping Chromium: a few hundred megabytes and a quarter of a gigabyte of memory per
render, on hosting a Rwandan cooperative pays for by the month. pdfkit is about a megabyte and
renders a page in milliseconds.

It follows `ui-system.md` §11: A4, a 14 mm margin, black on white, no colour, no shading behind
rows, the column headings repeated at the top of every page a table continues onto, and a two-line
footer naming the cooperative, the report, the period, who produced it, when, and the page number.

**Pagination is done by hand.** Rows are measured and placed rather than left to pdfkit's text flow,
so a row never straddles a page break and the header can be drawn again at the top of each page.

**Column widths are measured, not assigned.** Each column's full width and the width of its longest
single word are measured; every column is first given enough for its longest word, and what remains
is handed out by weight to the columns that want more, capped at what they asked for. Two defects
drove that design, both found by rendering the demonstration cooperative's own reports and reading
them:

- With widths assigned purely by weight, a reference printed as `FIN-2026-09-000` / `1` and a date as
  `1 September` / `2026`. A wrapped date is ugly; a reference broken across two lines is a document
  somebody copies the wrong number out of.
- With each column handed its full demand as soon as the page could afford it, whichever column
  settled last was starved: the Kinyarwanda member-code heading was left 67 points for a heading
  needing 102 and printed as `Inomero y’umun` / `yamuryango`.

Both are pinned by tests over `shareColumnWidths`.

Two further things the first renders got wrong, and what they cost:

- The footer was written past the bottom margin, which pdfkit treats as an overflow: a two-page
  report came out as six pages, four of them carrying nothing but a footer.
- Without `bufferPages`, `switchToPage` silently does nothing and every page claims to be page 1 of 1.

---

## 7. Language

The report catalogue holds the only user-facing strings outside the frontend's translation files,
because a PDF is rendered on the server where no i18next instance exists. That exception is bounded
by two tests.

`packages/shared/test/reports.test.ts` asserts the two languages carry the same keys, that no
Kinyarwanda label is a copy of its English one, and that every placeholder survives translation.

`apps/frontend/test/reportLabels.test.ts` asserts the catalogue's `enum.*` labels are **the same
words** as the interface's own translations, not a second translation of them. A report that called a
suspended member something different from the member screen is a report somebody quotes against the
screen and loses an argument over.

Month names are tabulated rather than taken from `Intl`, for the same reason digit grouping is done
by hand in `format.ts`: Kinyarwanda locale data is not present in every JavaScript runtime, and a
report must read exactly like the screen it was produced from.

A product the cooperative named in Kinyarwanda prints under that name. An English product name
sitting in the middle of a Kinyarwanda page is a report somebody has to have translated for them.

### The activity report

Audit actions print in words. `finance.transaction.voided` on a sheet filed with a cooperative's
auditors is not a report, so every action this application writes has a sentence in both languages.
`apps/backend/test/reports.test.ts` reads the distinct actions out of the audit log after the whole
suite has run and fails the build when one has no label — which is how nine missing labels were
found, including several the source grep had missed because their action is chosen by an expression.

---

## 8. Limits

A table shows at most 400 rows and then says how many rows it stands for, in the page and in the
file. A report is read, not a database dump; the CSV and the spreadsheet carry the same cap, and
the note says so rather than leaving a reader to assume the table is complete.

The stock valuation counts only products with a recorded purchase price and says how many it could
not value, rather than printing a total that looks complete.

Money out is written as a negative amount in the ledger table, matching the ledger screen, so a
column of figures adds up to the period's difference.
