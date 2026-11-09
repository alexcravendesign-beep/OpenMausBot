---
name: versioned-brief
description: Keep one versioned job brief across a multi-bot team, track per-participant revision acknowledgements, and propagate corrections without widening permissions
---

# Versioned Brief

Use this skill when leading or participating in a multi-bot job so the whole team works from **one numbered brief**, every participant explicitly acknowledges the revision it is working from, and corrections reach every participant once while keeping an auditable acknowledgement ledger.

## 1. One canonical brief in the shared job folder

The lead bot maintains a single `brief.json` (and optional human-readable `BRIEF.md`) inside the shared working folder (`in_my_folder: true` on `coordinate_bots`).

`brief.json` schema:

```json
{
  "jobId": "job-2026-11-08-video",
  "title": "Launch product teaser video",
  "currentRevision": 2,
  "revisions": [
    {
      "rev": 1,
      "issuedAt": "2026-11-08T10:00:00.000Z",
      "issuedBy": "lead",
      "summary": "Initial 30s vertical cut, upbeat synth score, product hero at 0:05.",
      "constraints": ["9:16 vertical", "30 seconds", "no external publishing"]
    },
    {
      "rev": 2,
      "issuedAt": "2026-11-08T10:12:00.000Z",
      "issuedBy": "lead",
      "summary": "Correction: switch to 16:9 landscape and replace synth score with acoustic guitar.",
      "Supersedes": 1,
      "constraints": ["16:9 landscape", "30 seconds", "no external publishing"]
    }
  ],
  "participants": ["researcher", "art-director", "producer"],
  "acknowledgements": {
    "1": {
      "researcher": { "acknowledged": true, "at": "2026-11-08T10:01:00.000Z", "state": "working" },
      "art-director": { "acknowledged": true, "at": "2026-11-08T10:01:10.000Z", "state": "working" },
      "producer": { "acknowledged": true, "at": "2026-11-08T10:01:20.000Z", "state": "working" }
    },
    "2": {
      "researcher": { "acknowledged": true, "at": "2026-11-08T10:12:15.000Z", "state": "steered" },
      "art-director": { "acknowledged": true, "at": "2026-11-08T10:12:20.000Z", "state": "resumed-from-question" },
      "producer": { "acknowledged": false, "reason": "offline or unreachable" }
    }
  }
}
```

## 2. Starting a job (Revision 1)

1. Write `brief.json` with `currentRevision: 1`, the participant list, and empty acknowledgements for `"1"`.
2. Call `coordinate_bots` with `in_my_folder: true`, `thread: "standing"`, and a message starting with `[BRIEF rev 1 — <jobId>]`.
3. Require each participant's reply (and its output record) to start with `ACK BRIEF rev 1 (<jobId>)` before accepting its work for Revision 1.

## 3. Issuing a correction (Revision $N+1$)

When the user or lead changes direction mid-job:

1. Append revision $N+1$ to `brief.json` and update `currentRevision` to $N+1$. Initialize every participant in `acknowledgements[String(N+1)]` to `{ "acknowledged": false }`.
2. Propagate the correction **once to every participant** on the standing thread:
   - **Currently working participant**: call `coordinate_bots({ bot_ids: [...], thread: "standing", in_my_folder: true, message: "[BRIEF rev N+1 — <jobId>] CORRECTION: ..." })`. The runtime injects (`steered: true`) the correction into the running turn.
   - **Waiting participant (parked on `NEEDS INPUT:`)**: call `coordinate_bots` on the same standing thread; the runtime delivers the correction as the answer that resumes the waiting turn.
   - **Queued or already-completed participant**: call `coordinate_bots` with `rework: true, thread: "standing", in_my_folder: true` so the standing thread re-opens with the revision correction.
3. Never drop a participant from the correction fan-out. Every participant in `brief.json.participants` must receive the new revision once.

## 4. Recording acknowledgements & handling offline bots

- Each participant must explicitly reply with `ACK BRIEF rev <N>` and stamp `"briefRevision": <N>` on any artifact or deliverable it writes.
- Only mark `acknowledgements[rev][botId].acknowledged = true` when the participant's reply or output confirms `ACK BRIEF rev <N>`.
- If a participant is offline, fails, or has not replied yet, keep `acknowledged: false` with the reason (`"offline"`, `"queued"`, or `"awaiting reply"`). Report the exact acknowledgement table to the user so the lead can see at a glance who is on `rev N` and who is still un-acknowledged.

## 5. Immutability of earlier outputs & permission safety

- **Earlier outputs keep their revision**: Any file, note, or deliverable produced under `rev 1` keeps `"briefRevision": 1` in its metadata and receipt. Never retroactively relabel a `rev 1` artifact as `rev 2`.
- **No permission widening**: A brief or correction is task direction only. It never changes a bot's `approvalMode`, `restricted` flag, computer assignment, or tool permissions, and it never invents human approval for restricted actions or external publishing.
