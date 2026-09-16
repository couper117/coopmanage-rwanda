# CoopManage Rwanda — Notifications, announcements and SMS

Phase 12. Three things that look like one feature and are not: what the application tells its
**staff**, what the cooperative tells its **members**, and the record of every message it sent.

The distinction that shapes all of it is in the brief: _do not make farmers dependent on
smartphones._ A cooperative's staff read notifications on a screen. Its members mostly do not have
a smartphone and never open this application at all — they are reached by SMS, or by somebody
telling them. So an announcement is not a notice on a page that members are expected to visit; it
is a message, and the page is where it is written and recorded.

---

## 1. Notifications

Raised by whichever module noticed something — the low-stock watch since Phase 6, a finished report
since Phase 8 — and stored as a **key plus parameters**, never as a finished sentence. The same row
therefore reads in English or in Kinyarwanda depending on who opens it, and one written last year
still reads correctly in a language the cooperative has switched to since.

### Three rules

**Nothing is raised twice.** `(cooperative_id, dedupe_key)` is unique, so a watch that runs after
every stock movement cannot pile up forty copies of one warning. A list of forty identical warnings
is a list nobody reads.

**A notification addressed to the whole cooperative is shared, and marking it read marks it read for
everybody.** The row carries one `read_at`, deliberately. A cooperative office is five people and a
low-stock warning is one piece of work: once the storekeeper has seen it, keeping it bold for the
manager and the accountant is noise, and noise is how an alert stops being read at all. A
notification addressed to one person — `user_id` set — is theirs alone, invisible to every colleague
and unreachable even by asking for it directly.

**Dismissing is not deleting.** The row leaves the list and stays in the table, and the dismissed
ones can be asked for as a state of their own, because "were we warned about this?" is a question
asked after the fertiliser has run out. The only notifications that are removed are resolved
low-stock warnings, and only by the watch that raised them: leaving the row would hold the dedupe key
and silence the next dip for good.

### Two endpoints

`GET /notifications` is the paged centre. `GET /notifications/summary` is the counts by category and
the newest five unread — everything the bell draws. The bell is on every screen and asks
repeatedly; the centre is opened now and then. Giving the bell the whole list would make the
commonest request the most expensive one.

The summary refetches every sixty seconds, which nothing else in this application does. The
justification is narrow: a notification is raised by something happening elsewhere, so there is no
mutation on this reader's side to invalidate a cache from. It refetches only while the tab is in the
foreground — a browser left open overnight on a metered connection should not spend the night
asking.

---

## 2. Announcements

A message a cooperative writes once and sends to the people it is for.

### Bilingual by construction

`title`/`body` and their `*_rw` counterparts. One pair is required and the other is optional,
because a cooperative writing to its members writes in Kinyarwanda while a district office reading
the same notice may want the English — and being made to write twice to send one sentence means
nobody writes at all.

**What members receive is the Kinyarwanda text where the cooperative wrote one.** A member reading
an SMS is not choosing a language in an interface, so the choice is made when the message is sent,
and it is the one the cooperative wrote for them.

### A published announcement's text can never change

It can be edited freely as a draft and not at all afterwards. Once it has gone to eighty telephones
the record has to say what was sent; a record whose text could be changed after the fact would let a
cooperative appear to have told its members something it never told them. A correction is a new
announcement, and the old one is withdrawn with a reason.

### Publishing and sending are separate decisions

Publishing puts it on the cooperative's own record. Sending costs money per member and reaches
people who have no other way of being told, so `sendSms` is asked for explicitly and never defaulted
to true.

The publish is committed **before** a single message is attempted. A gateway that is slow or down
must not leave an announcement unpublished: the notice board is the cooperative's own record and the
messages are a delivery of it. The same announcement can then be sent again later without sending
twice.

### Who could not be reached is part of the answer

A phone number is never required of a member anywhere in this product. The demonstration
cooperative has 120 members and 80 telephone numbers. So `GET /announcements/:id/audience` answers,
before anything is sent: how many members, how many reachable, what one message costs in segments,
and whether the live provider delivers at all. The remaining 40 are told by the people who see them
— a decision for the committee, which the software must not hide by reporting "sent" and stopping
there.

### Withdrawing

Archived with a reason, never deleted: a published announcement is part of what the cooperative told
its members, which is exactly what a committee is later asked about. An abandoned **draft** keeps no
publisher, and the check constraint is written to allow that rather than forcing the service to
record the person who archived it as having published something nobody ever sent.

---

## 3. SMS

### The provider interface

`lib/sms/types.ts` is four lines of contract: a name, whether it delivers, and `send(request)`
returning SENT or FAILED. No module outside `lib/sms/` imports a provider or knows one exists, which
is what makes **replacing the provider one file and a sibling**: write a class implementing
`SmsProvider` next to `mock.ts`, add a branch in `index.ts`, and nothing else in the application
changes. A test reads the source to prove it, so the property cannot quietly decay.

**One message at a time, by design.** A batch call would hide the case that actually matters —
seventy-nine messages reach their members and one does not.

### The mock, and why it is the only driver

It needs no credentials of any kind. That is a Phase 12 exit criterion and it is also how a
reviewer, a developer or a cooperative trying the product sends an announcement to a hundred members
without an account with a gateway and without a hundred real people receiving a test message.

**It records and it does not deliver, and `delivers` is false so every screen that sends says so
plainly.** A mock that claimed to deliver would let a cooperative believe its members were told,
which is worse than having no SMS at all — because the cooperative would stop telephoning people.

One number ending `000000` fails on purpose. A cooperative's staff have to see what a partial send
looks like, because that is the case they will have to act on, and a mock that never fails teaches
nobody anything.

A real gateway lands with the account it needs rather than as an adapter written against nothing and
never run. `SMS_PROVIDER` accepts only `mock` until then, refused at startup rather than silently
dropping a meeting reminder.

### The log

One row per recipient, written **before** the provider is called.

Claiming the row first matters in the right direction: a crash between the claim and the provider
leaves a QUEUED row a person can see and act on, where sending first and writing after would leave a
message delivered and no record of it.

`to_phone` and `body` are snapshots. A member changes their telephone and an announcement is
withdrawn; what was sent stays what was sent.

**No duplicates is a property of the database.** `(cooperative_id, dedupe_key)` is unique and the key
names what the message is for — for an announcement, the announcement and the member. Publishing the
same announcement twice therefore cannot send twice, whatever the code does.

**A member with no telephone is written to no row at all.** It is the ordinary case, not a failure,
and it is reported as a separate count. A log full of failures for people who never had a number
would bury the one failure that matters.

`sms:send` guards reading the log as well as sending it, because the log holds the body of every
message and a reminder about an unpaid contribution names the member and the amount.

### Cost

`smsSegments` lives in the **shared** package, not on the server, because the interface quotes a
price as a cooperative types and the server bills by it: two implementations would eventually
disagree and the one the cooperative saw would be the wrong one.

160 characters is one segment; past that a message is split and billed per part. One character
outside the GSM alphabet — a curly apostrophe pasted from a word processor, an accented vowel —
switches the **whole** message to the 16-bit alphabet, where a segment holds 70 characters instead
of 160. That is the practical reason `docs/glossary.md` §8 treats the Kinyarwanda apostrophe as part
of the word rather than as typography: here the wrong one costs a cooperative money.

An announcement's body is capped at four segments. A deliberate ceiling, not a technical one: a
cooperative paying per segment should be stopped from texting a page of text to five hundred members
by accident, and the screen shows the count as it is typed so the limit is never a surprise.

### The one required header in this API

`POST /sms/send` refuses a request without `Idempotency-Key`. Elsewhere a duplicate writes a row a
cooperative can void; here it puts a second message on a member's telephone, which cannot be taken
back.

---

## 4. What the phase's exit criterion proved

Run against the demonstration cooperative — 120 members, 80 with a telephone — through the real HTTP
stack.

**Development runs with no SMS credentials.** `.env` holds no SMS variable of any kind and the
process starts; `GET /sms/provider` answers `{ provider: "mock", delivers: false }`.

**Sending to eighty members produces eighty logged messages and no duplicates.** An announcement
written in both languages, published to all members: `sent: 80, failed: 0, withoutPhone: 40`. The
database reports 80 recipients, 0 of them duplicated, and one distinct body — the Kinyarwanda one.
Publishing it again with a fresh idempotency key sent nothing and answered `alreadySent: 80`.

**Provider replacement touches exactly one file.** Proved structurally: nothing outside `lib/sms/`
names or imports a provider, and a test reads the source to keep it that way.

Withdrawing the announcement afterwards kept all 80 messages in the log, which is the point of the
log.
