# CoopManage Rwanda — The dashboard and search

Phase 10. The dashboard answers one question — where does the cooperative stand — and the search box
answers the other one a manager asks all day: where is that record.

Both are built on a rule that runs through the rest of this system and is stricter here than
anywhere else, because both reach across every module at once: **a reader is never shown, and never
even asked about, data their role does not cover.** On the dashboard that means a block gated by the
permission covering its own data. In the search box it means a resource the caller may not read is
never queried at all.

---

## 1. One request

`GET /dashboard` returns the whole page: the tiles, the charts, the low-stock list, the attention
list, the recent activity and the health rating.

The plan listed four endpoints. There is one, for two reasons. The phase's exit criterion asks for a
single round trip, and on the connections this product is used over four requests is four chances to
be slow and four spinners finishing at different moments — for a page whose entire job is to be
readable at a glance. `docs/api.md` records the deviation.

Inside, the blocks are gathered with `Promise.all`. The criterion is one round trip for the client,
not one query for the database: five independent reads that run together are faster than five that
wait for each other, and far easier to reason about than one query that joins everything.

| Block                 | Permission       | What it is                                            |
| --------------------- | ---------------- | ----------------------------------------------------- |
| Members tile          | `members:view`   | Active members, with the register's total as the hint |
| Balance, income tiles | `finance:view`   | Balance, this month's income, this month's expenses   |
| Income/expense chart  | `finance:view`   | Twelve months, grouped bars                           |
| Expenses by category  | `finance:view`   | This month, top six then "Other"                      |
| Stock tile, low stock | `inventory:view` | Products held, and those at or below their minimum    |
| Sales tile, chart     | `sales:view`     | This month sold and outstanding; six months as a line |
| Recent activity       | `audit:view`     | The last eight audit entries                          |
| Overdue actions       | `meetings:view`  | Actions a meeting agreed and nobody closed            |

`dashboard:view` opens the endpoint and nothing more.

**A block the reader may not see is named, not dropped.** It comes back in `withheld`, and the page
says "your role does not cover: money, sales". A missing tile that looked like a zero would be a lie
about the cooperative's position, and a storekeeper who saw no money block could reasonably conclude
the cooperative has no money.

---

## 2. Cooperative health

Three signals, each with a rating and the figures behind it. The cooperative's rating is the worst
of them: a cooperative is as healthy as its least healthy part.

| Signal      | ATTENTION                        | WATCH                                |
| ----------- | -------------------------------- | ------------------------------------ |
| Money       | The balance is negative          | Expenses exceeded income this month  |
| Stock       | Something is out of stock        | Something is at or below its minimum |
| Receivables | A debt has stood 60 days or more | Anything is owed at all              |

Two decisions are worth stating.

**A month of spending more than came in is a WATCH, never an alarm.** A cooperative buying
fertiliser before planting does exactly that, and a product that cried emergency over it would
teach a manager to ignore it. The one unambiguous emergency is a negative balance: the cooperative
owes more than it holds.

**Sixty days is the line for a debt**, whatever the amount. A buyer who has not paid in two months
is a buyer the committee should be discussing.

### The rating names its figures

The banner does not print a verdict and leave the reader to trust it. Each signal writes a sentence
carrying the numbers it was judged on — "1,840,000 went out this month against 1,250,000 in, leaving
a balance of 4,820,000" — so a manager can check the judgement instead of taking it. The server
sends the key and the figures; the interface writes the sentence in the reader's language.

That is also why the stock signal carries a `count`. Three independent figures cannot all govern a
verb, and "1 products are out of stock" is not a sentence to put in front of anybody. `count` is the
figure the sentence is about and it changes with the rating — what has run out when something has,
otherwise what is running low, otherwise how many products there are — and each rating's sentence
has a singular form written for it in both languages.

---

## 3. What needs attention

Worst first, each line opening the screen where the work is done. The severity is `CRITICAL` or
`WARNING`, shown as **Urgent** and **Soon** — named for when the work has to happen, not for how it
feels. (They were "Urgent" and "Watch" until "Watch" collided with the health rating on the same
page. One word with two meanings side by side is a defect.)

The lines are: a negative balance, products out of stock, products running low, a debt 60 days old,
anything outstanding, and actions agreed at a meeting that are past their due date. Open actions are
everybody's business rather than the secretary's: the point of recording one is that the next
meeting can ask about it.

---

## 4. The charts

Three charts and one list, exactly as `docs/ui-system.md` §10 allows, and nothing else.

- **Money in and out** — twelve months, income against expenses as grouped bars. The question is a
  comparison within each month, not a trend across them.
- **Sales** — six months as a line, with the previous six ghosted behind it. This one _is_ a trend,
  and the comparison is the point: "four million" means nothing alone.
- **Where the money went** — this month's expenses by category, horizontal bars, the six largest
  then everything else as one. Category names are words and words read across. The remainder is
  kept rather than dropped, so the bars still add up to what the month cost.
- **Running low** — deliberately a list. A storekeeper needs the name and how much is left, which a
  bar cannot give them. A product at zero is called out separately from one merely running low,
  because only one of the two stops the cooperative selling today.

No charting package is installed, the content-security policy would not load one from a CDN, and a
bar is a `div` with a height. Every height is an exact integer ratio of minor units computed as
`bigint`, and **no figure the reader sees comes from that arithmetic**: every amount on screen is
rendered from the original decimal string.

Each chart keeps its table of figures in the document at all times, `sr-only` until revealed, with
the bars and the line `aria-hidden`. A screen reader is given the figures, not a row of decorative
shapes, and the button changes only whether they are also visible.

---

## 5. Recent activity

The last eight audit entries, each written as a sentence from its own key and parameters — the same
composition the activity log uses. A parameter that is itself a key, such as an enum the server sent
rather than translated, is resolved through `translateParams`: `SAVINGS` in the middle of a
Kinyarwanda sentence is not a translation.

Two details:

**The strings are fetched after the page is on screen.** The list quotes whichever module wrote each
entry, so it needs nearly every namespace, and only a reader with `audit:view` has the list at all.
Bundling those strings into the first download so a storekeeper can not-see them is exactly the
waste the code splitting was for. The panel shows a skeleton in its own place until they arrive:
nothing above it waits, and no reader ever sees a key.

**The actor is shown by name.** An entry records its actor as `Claudine Uwimana <uwimana…>`, and
that is right for the trail — the label is a snapshot that must still identify the account after a
rename or a departure. It is wrong for a glance, so the dashboard prints the name and the activity
log keeps the whole label.

---

## 6. Search

`GET /search?q=` searches members, products, buyers, sales, documents and meetings.

**A resource the caller may not read is never queried.** Not filtered out of the results, not ranked
down — not asked for at all. The permission is checked before the query is built, and the tenant is
in every `where` clause beside it. Filtering after the fact is how a search box becomes the way to
find out that a member called Mukamana exists, or that a document is named "Disciplinary letter",
without ever being allowed to open either. Restricted documents follow the documents module's own
visibility rule, because the existence of a member's medical letter is itself the sensitive part.

Kinds that were not searched come back in `withheld`, so the interface can say "not searched"
instead of letting a reader conclude there was nothing there.

**Ranking is by how well the term matches, then by recency.** An exact code scores 100, a prefix 70,
a substring 40; within a kind the most recent wins, because what somebody is looking for is far more
often what just happened. At most five hits of each kind are returned, with `truncated` saying when
there were more, so one noisy resource cannot crowd out the rest.

In the interface the box sits in the top bar on every screen, behind `search:use`. Results are
grouped by kind, and the groups are ordered by their best hit, so a member code typed in full puts
members first without hiding the sale that quotes it. `/` from anywhere puts the cursor in the box
unless a field already has focus; the arrows move the highlight, Enter opens it, Escape closes
without navigating. The query is held for 250 ms after typing stops and is never sent below two
characters — one letter matches most of a register, and the server refuses it with 422.

---

## 7. What the phase's exit criterion proved

Run against the demonstration cooperative through the real HTTP stack, with a manager's token.

`GET /dashboard` answered the whole page in one request: five tiles, three charts, two low-stock
rows, two attention items, eight activity entries, and a health rating of `ATTENTION` carrying all
three of its signals. The rating was earned by 1,040,000 outstanding for 69 days — which is the
sentence the banner prints, not a coloured dot. The stock signal came back `WATCH` with
`count: 2`, matching its `low`, which is what makes the plural come out right.

`GET /search?q=uwa` returned five members ranked at 70 for a prefix match, with `truncated: true`
because a sixth was found and withheld to keep one kind from crowding out the others. `?q=x` is
refused with 422 and `validation.too_small` rather than being allowed to scan the register on one
letter.

Two defects found by building the interface against the real data, both fixed rather than
documented: "Watch" meant two different things on the same page, and the loading state showed a grey
box where the page's `h1` belonged.
