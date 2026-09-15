# CoopManage Rwanda — Documents and meetings

Status: **Phase 9 complete.** Documents with validated uploads and authenticated downloads;
meetings with agendas, attendance, decisions and minutes. The minutes report arrived with them.

---

## 1. Documents

### Nothing is publicly readable, ever

There is no URL that serves a file. The bytes live in object storage under a key that never leaves
the server, and the only way to them is `GET /documents/:id/download`, which authenticates,
resolves the tenant, checks `documents:view`, applies the document's own visibility rule, and then
streams.

The storage key is `<year>/<month>/<48 hex characters>` — 24 bytes from the system's cryptographic
source. Nothing in it comes from the filename, the title, the member or the cooperative, so a key
cannot be derived from anything a user has seen, and guessing one is 192 bits of work. A check
constraint on `documents` pins that shape, so a key built any other way cannot reach the column, and
the local driver refuses a key that is not that shape before it touches a path. The key appears in
no API response.

The interface follows from that: a preview is an object URL over bytes fetched with the session's
headers, not an `<img src>` pointed at the API. `useDocumentPreview` holds the blob and revokes the
URL when the reader moves on.

### Three checks on every upload

The **extension**, the **declared MIME type** and the **actual first bytes** all have to agree. Any
one alone is a claim the uploader controls.

The executable check runs **first**, on the content, before the extension is looked at — so a
`.pdf` holding a Windows binary is refused as an executable rather than reaching the PDF signature
check and being refused for a vaguer reason. The person uploading is told what the file actually is,
which is the difference between fixing the upload and trying the same file again.

Refused outright: Windows PE, ELF, Mach-O (both byte orders, and the universal-binary signature that
Java class files share), shell scripts, Windows batch files. Also refused: a ZIP renamed `.docx`,
because every OOXML package carries `[Content_Types].xml` and the part prefix for its own kind, and
both are checked. Text has no signature, so it is checked the other way round: no NUL byte, valid
UTF-8, and none of the executable headers.

**SVG is not accepted.** It is an image to a reader and a script host to a browser.

Accepted: PDF, JPEG, PNG, WebP, `.docx`, `.xlsx`, CSV, plain text. Ten megabytes by default,
configurable, enforced by the multipart parser before anything is read.

Uploads are parsed **in memory**. A temporary file would mean the bytes exist on disk before
anything has looked at them — a window in which a disguised executable is a real file on the server
— and a path to clean up on every failure.

### Download headers

| Header                                  | Why                                                                  |
| --------------------------------------- | -------------------------------------------------------------------- |
| `X-Content-Type-Options: nosniff`       | Stops a browser treating a text file as HTML                         |
| `Content-Security-Policy: sandbox; ...` | Neutralises a previewed PDF's own scripting                          |
| `Content-Disposition: attachment`       | Unless the type is inline-safe _and_ a preview was asked for         |
| `Cache-Control: private, no-store`      | Keeps a contract out of a shared proxy and off a café machine's disk |

`inline` is honoured only for PDF and images. A CSV asked for inline is still sent as a download:
serving an uploaded `text/*` inline is the shape of a stored-XSS bug, and a browser rendering a CSV
is of no use to anybody.

The filename in the header is the base name with control characters, quotes and semicolons stripped
— all three are header injection through a field the uploader controls — and any path discarded, so
`../../etc/passwd.pdf` is stored as `passwd.pdf`.

### Visibility

`COOPERATIVE` is everybody with `documents:view`. `RESTRICTED` narrows it to the person who
uploaded it and to staff holding `documents:archive`, the custodian permission: whoever is trusted
to take a document out of circulation is trusted to read the sensitive ones.

It is a `where` clause, not a filter after the fact, so a restricted document is unreachable rather
than merely hidden — and a caller who may not see it gets "not found", because the existence of a
member's medical letter is itself the sensitive part.

### Archived, never deleted

There is no `DELETE` endpoint and no delete control. A superseded document is archived with a
required reason, and the row and the file both stay. An archived document is read-only until it is
restored, because editing its title would change what the history says; it can still be downloaded,
since an archived contract is still the contract. A document that is a meeting's minutes cannot be
archived while the meeting points at it.

### A checksum worth having

The SHA-256 of the file as uploaded, shown in full on the detail view so a cooperative can check a
copy against it. Truncating it would make it decoration.

---

## 2. Meetings

### Quorum is counted, never asserted

The number required sits on the meeting; the number present is counted from attendance taken
against the member register. Nothing anywhere stores "quorum: yes", so nothing can say yes when the
register says otherwise.

Two figures come back with every meeting, and the distinction matters:

- `presentCount` — everybody marked present: members, staff and guests. Who was in the room.
- `memberPresentCount` — **members only, and the only figure quorum is measured against.**

The second was a defect in the first version, found by a test: a district cooperative officer
attending as a guest counted towards the cooperative's quorum. A quorum is a number of members.

`quorumMet` is `null` where no quorum is set. "Not required" and "not met" are different answers,
and showing the second for the first would tell a cooperative its committee meeting was invalid when
its own statutes say nothing of the kind. Every screen and the report honour that: no badge at all
rather than a cross.

### A completed meeting is closed

Its agenda, its attendance and its decisions stop being editable. Minutes that can be rewritten
afterwards are not minutes.

Two things still change on a closed meeting, both deliberately:

- **the minutes can be attached**, because that is the normal order of events — the record arriving
  is not a change to the record;
- **an action can be marked done**, because an action recorded in March is closed in June and a
  decision list that could never be closed would be useless within a year. The title, the text and
  the votes are not accepted by the update endpoint at all.

The interface hides every editing control on a closed meeting. That is not the enforcement — the
server refuses either way — but a screen that offered a control and then failed would teach a
secretary that the system is unreliable rather than that the record is final.

### Whole-list replacement

The agenda and the attendance are `PUT` as the list should now read, not a sequence of add, move and
remove. A secretary reorders three items, merges two and drops one before saving; sending that as
per-item operations means the client reconstructs positions and the server honours a half-applied
order. So the editors hold the list in local state — which is why "move up" and "remove" are instant
— and send it once, inside one transaction.

Positions are never sent. The array order is the order, numbered from one by the server: a client
that had to supply positions is the client that eventually sends two items numbered three.

Decisions are the opposite. A decision is created once, and a removed agenda item leaves it with its
own record and no pointer (`onDelete: SetNull`), because what a meeting decided does not stop being
true because the agenda was rearranged.

### Votes as three counts

For, against, abstained, each optional. Minutes have to show how a decision was carried and not
merely that it was — and a committee that reached a decision by consensus took no vote, so writing
0/0/0 for that would claim something untrue. The interface leaves the three fields empty and sends
`null`.

### No deletions

A meeting that will not happen is cancelled with a reason, which the database insists on. A
cooperative's minute book has no missing numbers, and a meeting that could be removed would leave
one. References are `MTG-<year>-<six digits>`, counted within the year the meeting is scheduled for:
the seventh meeting of 2026, not the seventh since installation.

---

## 3. Storage drivers

`docs/architecture.md` §10 describes two: a local filesystem driver for development and for a
cooperative running the system on one machine in its own office, and an S3-compatible driver for
Supabase Storage in production.

**The local driver is here. The S3 driver lands in Phase 18 with the bucket it needs.** A signing
implementation written against no real endpoint is a driver nobody has run, so rather than ship one
untested, `STORAGE_DRIVER=s3` **refuses at startup** with a message naming the phase. A cooperative
discovering on Monday that last week's documents went nowhere is the failure that guard prevents,
and the environment schema refuses the value for the same reason.

No module outside `src/lib/storage/` imports a driver. The interface has no `url()` method and never
will: a method that handed out a URL would be the one way to get a cooperative's land title onto the
open internet.

---

## 4. Endpoints

| Method | Path                                  | Access              |
| ------ | ------------------------------------- | ------------------- |
| GET    | `/documents`                          | `documents:view`    |
| GET    | `/documents/options`                  | `documents:upload`  |
| POST   | `/documents`                          | `documents:upload`  |
| GET    | `/documents/:id`                      | `documents:view`    |
| GET    | `/documents/:id/download`             | `documents:view`    |
| PATCH  | `/documents/:id`                      | `documents:upload`  |
| POST   | `/documents/:id/archive`              | `documents:archive` |
| POST   | `/documents/:id/restore`              | `documents:archive` |
| GET    | `/meetings`                           | `meetings:view`     |
| GET    | `/meetings/options`                   | `meetings:manage`   |
| POST   | `/meetings`                           | `meetings:manage`   |
| GET    | `/meetings/:id`                       | `meetings:view`     |
| PATCH  | `/meetings/:id`                       | `meetings:manage`   |
| POST   | `/meetings/:id/status`                | `meetings:manage`   |
| PUT    | `/meetings/:id/agenda`                | `meetings:manage`   |
| PUT    | `/meetings/:id/attendance`            | `meetings:manage`   |
| POST   | `/meetings/:id/decisions`             | `meetings:manage`   |
| PATCH  | `/meetings/:id/decisions/:decisionId` | `meetings:manage`   |

The upload runs its multipart parser **after** authentication, the tenant and the permission, so an
anonymous request cannot make the server read ten megabytes before being refused.

`/documents/options` and `/meetings/options` are registered before their `:id` routes, so neither is
read as a record whose identifier is the word "options".

---

## 5. What the phase's exit criterion proved

Run against the demonstration cooperative's own seeded document, through the real HTTP stack:

| Request                                   | Answer                                                   |
| ----------------------------------------- | -------------------------------------------------------- |
| Download with no session                  | `401 UNAUTHENTICATED`                                    |
| Session naming no cooperative             | `403 NO_COOPERATIVE_ACCESS`                              |
| Session in **another** cooperative        | `404 NOT_FOUND` — not 403, which would confirm it exists |
| Session in the right cooperative          | `200`, `attachment`, `nosniff`, the bytes                |
| A Windows executable named `icyemezo.pdf` | `415 UNSUPPORTED_FILE_TYPE` / `errors.files.executable`  |
| A genuine PDF                             | `201`                                                    |

The last row matters as much as the one above it: a gate that refused everything would also pass the
criterion.
