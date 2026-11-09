---
name: deliverable-receipt
description: Attach a versioned deliverable receipt to a job with brief revision provenance, distinct draft/reviewed/published states, and review evidence rendered via chat cards or pages
---

# Deliverable Receipt

Use this skill when a job produces a concrete deliverable (cut, deck, report, asset pack, or page) so the person can find the final result without reading the chat transcript, open any older version, verify which brief revision each version came from, and see the review evidence.

## 1. Receipt ledger (`deliverables.json`)

Write `deliverables.json` in the job's shared folder alongside `brief.json`. Every version of a deliverable is an immutable entry:

```json
{
  "jobId": "job-2026-11-08-video",
  "deliverableId": "launch-teaser-cut",
  "title": "Launch Product Teaser Cut",
  "latestVersion": 2,
  "versions": [
    {
      "version": 1,
      "title": "Launch Product Teaser Cut (v1 — 9:16 vertical)",
      "fileOrLink": "deliverables/launch-teaser-v1.mp4",
      "jobId": "job-2026-11-08-video",
      "briefRevision": 1,
      "producedBy": "producer",
      "createdAt": "2026-11-08T10:05:00.000Z",
      "state": "reviewed",
      "reviewerOutcome": {
        "reviewer": "art-director",
        "decision": "superseded",
        "evidence": "Matches rev 1 vertical spec; superseded when brief rev 2 switched to 16:9 landscape."
      },
      "public": false
    },
    {
      "version": 2,
      "title": "Launch Product Teaser Cut (v2 — 16:9 landscape)",
      "fileOrLink": "deliverables/launch-teaser-v2.mp4",
      "jobId": "job-2026-11-08-video",
      "briefRevision": 2,
      "producedBy": "producer",
      "createdAt": "2026-11-08T10:18:00.000Z",
      "state": "reviewed",
      "reviewerOutcome": {
        "reviewer": "art-director",
        "decision": "approved",
        "evidence": "Verified 16:9 aspect ratio, acoustic guitar audio track, and hero frame at 0:05 against brief rev 2."
      },
      "public": false
    }
  ]
}
```

## 2. Required fields on every version

Every entry in `versions[]` must record:
- `title`: human-readable title for this version.
- `version`: monotonic integer (`1`, `2`, ...).
- `fileOrLink`: workspace-relative file path or URL to the artifact.
- `jobId` and `briefRevision`: the originating job ID and the exact `brief.json` revision number the bot worked from.
- `state`: one of `"draft"`, `"reviewed"`, or `"published"`.
- `reviewerOutcome`: `{ reviewer, decision, evidence }` once reviewed (`null` while `"draft"`).
- `public`: boolean (`false` unless explicitly published by a human-approved step).

## 3. State discipline: nothing publishes automatically

- **`draft`**: initial state when a bot produces a file. `reviewerOutcome` is `null` and `public` is `false`.
- **`reviewed`**: set only after a designated reviewer bot or human checks the artifact against its `briefRevision` and records concrete `evidence`. `public` remains `false`.
- **`published`**: never transition to `"published"` or set `"public": true` automatically when a job or review finishes. Publishing requires an explicit human instruction and approval.

## 4. Surfacing the receipt without new UI

When the job finishes (or when a new version is recorded):
1. Attach the deliverable file(s) and `deliverables.json` with `attach_file` so they appear directly on the turn.
2. Render the visual receipt card in chat with `show_html` (starting from `receipt.html` in this skill folder and embedding the `deliverables.json` payload in `<script id="embedded-data" type="application/json">`) or `show_widget`.
3. The rendered receipt shows the latest version prominently, lists all prior versions with their `briefRevision` badges (`Brief rev 1`, `Brief rev 2`), displays the reviewer evidence for each version, and clearly badges `draft` / `reviewed` / `published` and `Private (not public)`.
