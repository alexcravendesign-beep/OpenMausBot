import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { loadBundledSkills, selectBundledSkills } from "./skill-library.ts";
import { parseSkillMd, scanSkillText } from "./skills.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { ownTurnText } from "./testing/room-handoff-agent.ts";

// Keep unix domain socket paths under macOS 104-byte sun_path limit during isolated verification runs.
process.env.TMPDIR = "/tmp";

const SETTLED = "Your downstream room requests have settled.";

type Row = Record<string, any>;
const jsonl = (path: string): any[] =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

function assignments(dataDir: string): Row[] {
  const path = join(dataDir, "runtime.db");
  if (!existsSync(path)) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare("SELECT json FROM assignments ORDER BY created_at, id").all() as Array<{ json: string }>).map(
      (row) => JSON.parse(row.json) as Row,
    );
  } finally {
    db.close();
  }
}

describe("F2 & F3 bundled skills (versioned-brief and deliverable-receipt)", () => {
  const bundled = loadBundledSkills(join(process.cwd(), "skills"));

  it("loads both bundled skills cleanly, passes security scans, and selects on trigger phrases", () => {
    const briefSkill = bundled.find((skill) => skill.manifest.id === "versioned-brief");
    const receiptSkill = bundled.find((skill) => skill.manifest.id === "deliverable-receipt");
    expect(briefSkill).toBeDefined();
    expect(receiptSkill).toBeDefined();

    for (const skill of [briefSkill!, receiptSkill!]) {
      const parsed = parseSkillMd(skill.instructions);
      expect("error" in parsed).toBe(false);
      expect(scanSkillText(skill.instructions)).toEqual([]);
    }

    const selectedBrief = selectBundledSkills(
      "Please update the brief revision and check who acknowledged the brief",
      [],
      bundled,
    ).map((skill) => skill.manifest.id);
    expect(selectedBrief).toContain("versioned-brief");

    const selectedReceipt = selectBundledSkills(
      "Show the deliverable receipt and deliverable versions for this job",
      [],
      bundled,
    ).map((skill) => skill.manifest.id);
    expect(selectedReceipt).toContain("deliverable-receipt");

    const unrelated = selectBundledSkills("What is the weather in Tokyo?", [], bundled).map(
      (skill) => skill.manifest.id,
    );
    expect(unrelated).not.toContain("versioned-brief");
    expect(unrelated).not.toContain("deliverable-receipt");
  });

  it("ships a self-contained receipt.html template that renders version provenance and review state", () => {
    const templatePath = join(process.cwd(), "skills", "deliverable-receipt", "receipt.html");
    expect(existsSync(templatePath)).toBe(true);
    const html = readFileSync(templatePath, "utf8");
    expect(html).toContain('id="embedded-data"');
    expect(html).toContain("Brief rev");
    expect(html).toContain("Private (not public)");
    expect(scanSkillText(html)).toEqual([]);
  });
});

describe("F2 & F3 three-bot isolated fixture (Researcher, Art Director, Producer)", () => {
  it(
    "replays the 8 Nov brief correction across working, waiting, queued, and offline bots and attaches a two-version deliverable receipt",
    async () => {
      const session = await launchVerificationServer(
        { ...process.env, TMPDIR: "/tmp" },
        undefined,
        undefined,
        undefined,
        undefined,
        { scripted: true },
      );
      const { url, dataDir } = session.info;
      try {
        const api = async (method: string, path: string, body?: unknown) => {
          const response = await fetch(`${url}${path}`, {
            method,
            headers: { "content-type": "application/json", origin: url },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(20_000),
          });
          const raw = await response.text();
          let parsed: any = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {}
          return { status: response.status, body: parsed };
        };

        const makeBot = async (name: string, section: string) =>
          ((await runControlOmb(["new-bot", "--name", name, "--section", section, "--url", url])) as any).bot;

        const lead = await makeBot("Lead", "Leadership");
        const researcher = await makeBot("Researcher", "Creative");
        const artDirector = await makeBot("Art Director", "Creative");
        const producer = await makeBot("Producer", "Creative");

        expect(
          (
            await api("PATCH", `/api/bots/${lead.id}`, {
              chiefOfStaff: true,
              managedSections: ["Creative"],
              acknowledgePeerScope: true,
            })
          ).status,
        ).toBe(200);

        // Set ask-first approval mode and restricted flag on the three specialist bots
        // so we can verify that NEEDS INPUT parks and that no brief correction widens permissions.
        for (const id of [lead.id, researcher.id, artDirector.id, producer.id]) {
          expect(
            (
              await api("PATCH", `/api/bots/${id}`, {
                approvalMode: "ask",
                applyToAllThreads: true,
                ...(id === lead.id ? {} : { restricted: true }),
              })
            ).status,
          ).toBe(200);
        }

        const planPath = join(dataDir, "room-plan.json");
        const plan: Record<string, { script: unknown[] }> = {
          [lead.id]: { script: [] },
          [researcher.id]: { script: [] },
          [artDirector.id]: { script: [] },
          [producer.id]: { script: [] },
        };
        const script = (botId: string, ...entries: unknown[]) => {
          plan[botId]!.script.push(...entries);
          writeFileSync(planPath, JSON.stringify(plan));
        };
        writeFileSync(planPath, JSON.stringify(plan));

        const job = lead.activeTaskId as string;
        const say = async (botId: string, threadId: string, text: string) => {
          const sent = await api("POST", `/api/bots/${botId}/messages`, { text, threadId });
          expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);
        };
        const children = () => assignments(dataDir).filter((row) => row.parentId);
        const turns = (botId: string): any[] =>
          jsonl(`${planPath}.evidence.jsonl`).filter((turn) => turn.botId === botId);
        const turn = (key: string) => jsonl(`${planPath}.evidence.jsonl`).find((candidate) => candidate.planKey === key);
        const replies = (key: string): any[] =>
          (turn(key)?.evidence ?? [])
            .filter((entry: any) => entry?.step && (!entry.step.tool || entry.step.tool === "coordinate_bots"))
            .map((entry: any) => {
              const text = String(entry.response.result.content[0].text);
              return entry.response.result.isError ? text : JSON.parse(text);
            });
        const messages = async (threadId: string): Promise<any[]> =>
          (await api("GET", `/api/threads/${threadId}/messages?limit=300`)).body.messages ?? [];
        const said = async (threadId: string, text: string) =>
          (await messages(threadId)).filter(
            (message) => message.role === "bot" && message.kind === "text" && String(message.text).includes(text),
          ).length;

        const jobId = "job-2026-11-08-teaser";
        const receiptTemplate = readFileSync(join(process.cwd(), "skills", "deliverable-receipt", "receipt.html"), "utf8");

        // -----------------------------------------------------------------------
        // PHASE A: Brief Rev 1 distributed to Researcher, Art Director, Producer.
        // All three acknowledge Rev 1; Producer produces Deliverable v1 under Rev 1.
        // -----------------------------------------------------------------------
        const briefRev1 = {
          jobId,
          title: "Launch Product Teaser Video",
          currentRevision: 1,
          revisions: [
            {
              rev: 1,
              issuedAt: "2026-11-08T10:00:00.000Z",
              issuedBy: lead.id,
              summary: "30s vertical (9:16) teaser with synthwave score and hero product shot at 0:05.",
              constraints: ["9:16 vertical", "30s duration", "do not publish externally"],
            },
          ],
          participants: [researcher.id, artDirector.id, producer.id],
          acknowledgements: {
            "1": {
              [researcher.id]: { acknowledged: true, state: "completed", ackText: `ACK BRIEF rev 1 (${jobId})` },
              [artDirector.id]: { acknowledged: true, state: "completed", ackText: `ACK BRIEF rev 1 (${jobId})` },
              [producer.id]: { acknowledged: true, state: "completed", ackText: `ACK BRIEF rev 1 (${jobId})` },
            },
          },
        };

        const deliverablesAfterV1 = {
          jobId,
          deliverableId: "teaser-cut",
          title: "Launch Product Teaser Video",
          latestVersion: 1,
          versions: [
            {
              version: 1,
              title: "Launch Teaser Cut v1 (9:16 Vertical)",
              fileOrLink: "deliverables-v1-vertical.txt",
              jobId,
              briefRevision: 1,
              producedBy: producer.id,
              createdAt: "2026-11-08T10:05:00.000Z",
              state: "reviewed",
              reviewerOutcome: {
                reviewer: artDirector.id,
                decision: "approved-for-rev-1",
                evidence: "Checked 9:16 vertical framing and synthwave score against Brief rev 1.",
              },
              public: false,
            },
          ],
        };

        script(
          lead.id,
          {
            key: "L-REV1-SEND",
            match: ["START-REV1-JOB"],
            steps: [
              {
                arguments: {
                  bot_ids: [researcher.id, artDirector.id, producer.id],
                  in_my_folder: true,
                  done_when: "Acknowledge Brief rev 1 and produce Deliverable v1",
                  message: `REV1-BRIEF [BRIEF rev 1 — ${jobId}]: Produce 30s vertical (9:16) teaser with synthwave score.`,
                },
              },
            ],
            writeFiles: {
              "brief.json": JSON.stringify(briefRev1, null, 2),
              "deliverables-v1-vertical.txt": "TEASER CUT v1 | aspect=9:16 | score=synthwave | briefRevision=1\n",
              "deliverables.json": JSON.stringify(deliverablesAfterV1, null, 2),
            },
            reply: "L-REV1-SEND: Issued Brief rev 1 to Researcher, Art Director, and Producer.",
          },
          {
            key: "L-REV1-SETTLED",
            match: [SETTLED, "START-REV1-JOB", "ACK BRIEF rev 1"],
            reply: "L-REV1-FINAL: All three bots acknowledged Brief rev 1 and Deliverable v1 (Brief rev 1) is recorded.",
          },
        );

        script(researcher.id, {
          key: "R-REV1",
          match: ["REV1-BRIEF"],
          reply: `ACK BRIEF rev 1 (${jobId}): audience hooks compiled under rev 1.`,
        });
        script(artDirector.id, {
          key: "AD-REV1",
          match: ["REV1-BRIEF"],
          reply: `ACK BRIEF rev 1 (${jobId}): 9:16 vertical storyboard locked and v1 reviewed under rev 1.`,
        });
        script(producer.id, {
          key: "P-REV1",
          match: ["REV1-BRIEF"],
          writeFiles: {
            "deliverables-v1-vertical.txt": "TEASER CUT v1 | aspect=9:16 | score=synthwave | briefRevision=1\n",
          },
          reply: `ACK BRIEF rev 1 (${jobId}): produced deliverables-v1-vertical.txt under Brief rev 1.`,
        });

        await say(lead.id, job, "START-REV1-JOB: start the teaser job under Brief rev 1.");
        await expect.poll(async () => await said(job, "L-REV1-FINAL"), { timeout: 30_000 }).toBe(1);

        const rev1Children = children();
        expect(rev1Children).toHaveLength(3);
        expect(rev1Children.every((c) => c.status === "completed")).toBe(true);
        for (const participant of [researcher, artDirector, producer]) {
          expect(rev1Children.find((c) => c.assignee.botId === participant.id)?.result).toContain(
            `ACK BRIEF rev 1 (${jobId})`,
          );
        }

        // -----------------------------------------------------------------------
        // PHASE B: Replay the 8 Nov mid-job correction (Brief Rev 2: switch to
        // 16:9 landscape + acoustic score) across all three participant states:
        // - Researcher is WORKING (held at gateFile, echoSteered: true) -> steered mid-turn
        // - Art Director is WAITING on a question (NEEDS INPUT) -> answered & resumed
        // - Producer is QUEUED / completed earlier turn -> receives correction via rework: true
        // Producer writes Deliverable v2 under Brief rev 2 while v1 retains Brief rev 1,
        // and Lead attaches the files + renders the Deliverable Receipt via show_html.
        // -----------------------------------------------------------------------
        const researcherReady = join(dataDir, "researcher-working.ready");
        const researcherGate = join(dataDir, "researcher-working.gate");

        const briefRev2 = {
          ...briefRev1,
          currentRevision: 2,
          revisions: [
            ...briefRev1.revisions,
            {
              rev: 2,
              issuedAt: "2026-11-08T10:12:00.000Z",
              issuedBy: lead.id,
              supersedes: 1,
              summary: "CORRECTION: Switch to 16:9 landscape and acoustic guitar score.",
              constraints: ["16:9 landscape", "30s duration", "do not publish externally"],
            },
          ],
          acknowledgements: {
            ...briefRev1.acknowledgements,
            "2": {
              [researcher.id]: {
                acknowledged: true,
                state: "steered-while-working",
                ackText: `ACK BRIEF rev 2 (${jobId})`,
              },
              [artDirector.id]: {
                acknowledged: true,
                state: "resumed-from-waiting",
                ackText: `ACK BRIEF rev 2 (${jobId})`,
              },
              [producer.id]: {
                acknowledged: true,
                state: "queued-rework",
                ackText: `ACK BRIEF rev 2 (${jobId})`,
              },
            },
          },
        };

        const deliverablesAfterV2 = {
          ...deliverablesAfterV1,
          latestVersion: 2,
          versions: [
            {
              ...deliverablesAfterV1.versions[0]!,
              reviewerOutcome: {
                reviewer: artDirector.id,
                decision: "superseded-by-rev-2",
                evidence: "Built under Brief rev 1 (9:16 vertical); retained as v1 history.",
              },
            },
            {
              version: 2,
              title: "Launch Teaser Cut v2 (16:9 Landscape)",
              fileOrLink: "deliverables-v2-landscape.txt",
              jobId,
              briefRevision: 2,
              producedBy: producer.id,
              createdAt: "2026-11-08T10:18:00.000Z",
              state: "reviewed",
              reviewerOutcome: {
                reviewer: artDirector.id,
                decision: "approved",
                evidence: "Verified 16:9 landscape framing and acoustic guitar score against Brief rev 2.",
              },
              public: false,
            },
          ],
        };

        const populatedReceiptHtml = receiptTemplate.replace(
          /<script id="embedded-data" type="application\/json">[\s\S]*?<\/script>/,
          `<script id="embedded-data" type="application/json">\n${JSON.stringify(deliverablesAfterV2, null, 2)}\n</script>`,
        );

        script(researcher.id, {
          key: "R-WORKING",
          match: ["PRE-REV2-RESEARCH"],
          readyFile: researcherReady,
          gateFile: researcherGate,
          echoSteered: true,
          reply: `ACK BRIEF rev 2 (${jobId}): researcher steered mid-turn onto 16:9 landscape brief`,
        });

        script(
          artDirector.id,
          {
            key: "AD-RESUMED-REV2",
            match: ["PRE-REV2-ART", "@Lead answered"],
            reply: `ACK BRIEF rev 2 (${jobId}): art director resumed from waiting question and approved Deliverable v2 against Brief rev 2.`,
          },
          {
            key: "AD-WAITING",
            match: ["PRE-REV2-ART"],
            reply: "Checking end-card framing.\nNEEDS INPUT: Should the end-card stay 9:16 vertical or switch to 16:9 landscape?",
          },
        );

        script(producer.id, {
          key: "P-REWORK-REV2",
          match: ["REV2-CORRECTION"],
          writeFiles: {
            "deliverables-v2-landscape.txt": "TEASER CUT v2 | aspect=16:9 | score=acoustic-guitar | briefRevision=2\n",
          },
          reply: `ACK BRIEF rev 2 (${jobId}): produced deliverables-v2-landscape.txt (v2) under Brief rev 2; v1 remains on Brief rev 1.`,
        });

        script(
          lead.id,
          {
            key: "L-PRE-REV2",
            match: ["START-PRE-REV2"],
            steps: [
              {
                arguments: {
                  bot_ids: [researcher.id],
                  in_my_folder: true,
                  message: "PRE-REV2-RESEARCH: Start deep-dive audience pass for the teaser.",
                },
              },
              {
                arguments: {
                  bot_ids: [artDirector.id],
                  in_my_folder: true,
                  message: "PRE-REV2-ART: Prepare end-card layout for the teaser.",
                },
              },
            ],
            reply: "L-PRE-REV2: Researcher and Art Director started.",
          },
          {
            key: "L-AD-ASKED",
            match: ["question on assignment", "Should the end-card stay 9:16 vertical"],
            reply: "L-AD-ASKED: Art Director is waiting on aspect-ratio confirmation.",
          },
          {
            key: "L-ISSUE-REV2",
            match: ["ISSUE-REV2-CORRECTION"],
            steps: [
              {
                arguments: {
                  bot_ids: [researcher.id, artDirector.id, producer.id],
                  in_my_folder: true,
                  rework: true,
                  message: `REV2-CORRECTION [BRIEF rev 2 — ${jobId}]: Switch to 16:9 landscape and acoustic guitar score; produce and review Deliverable v2 under Brief rev 2.`,
                },
              },
            ],
            writeFiles: {
              "brief.json": JSON.stringify(briefRev2, null, 2),
              "deliverables-v2-landscape.txt": "TEASER CUT v2 | aspect=16:9 | score=acoustic-guitar | briefRevision=2\n",
              "deliverables.json": JSON.stringify(deliverablesAfterV2, null, 2),
            },
            reply: "L-ISSUE-REV2: Propagated Brief rev 2 to Researcher (working), Art Director (waiting), and Producer (rework).",
          },
          {
            key: "L-PRE-REV2-SETTLED",
            match: [SETTLED, "START-PRE-REV2", "ACK BRIEF rev 2"],
            reply: "L-PRE-REV2-SETTLED: Researcher (steered) and Art Director (resumed from question) acknowledged Brief rev 2.",
          },
          {
            key: "L-REV2-SETTLED",
            match: [SETTLED, "ISSUE-REV2-CORRECTION", "ACK BRIEF rev 2"],
            steps: [
              {
                tool: "attach_file",
                arguments: { path: "brief.json", name: "brief.json" },
              },
              {
                tool: "attach_file",
                arguments: { path: "deliverables.json", name: "deliverables.json" },
              },
              {
                tool: "attach_file",
                arguments: {
                  path: "deliverables-v1-vertical.txt",
                  name: "deliverables-v1-vertical.txt",
                },
              },
              {
                tool: "attach_file",
                arguments: {
                  path: "deliverables-v2-landscape.txt",
                  name: "deliverables-v2-landscape.txt",
                },
              },
              {
                tool: "show_html",
                arguments: {
                  title: "Deliverable Receipt — Launch Product Teaser Video",
                  html: populatedReceiptHtml,
                },
              },
            ],
            reply: "L-REV2-FINAL: Brief rev 2 acknowledged by all three bots; Deliverable Receipt (v1 @ rev 1, v2 @ rev 2) attached.",
          },
        );

        await say(lead.id, job, "START-PRE-REV2: kick off Researcher and Art Director follow-ups.");
        await expect.poll(() => existsSync(researcherReady), { timeout: 20_000 }).toBe(true);
        await expect.poll(
          () => children().some((c) => c.assignee.botId === artDirector.id && c.status === "needs_input"),
          { timeout: 30_000 },
        ).toBe(true);
        await expect.poll(async () => await said(job, "L-AD-ASKED"), { timeout: 30_000 }).toBe(1);

        // Issue the Brief Rev 2 correction while Researcher is working, Art Director is waiting on NEEDS INPUT, and Producer is idle/completed
        await say(
          lead.id,
          job,
          "ISSUE-REV2-CORRECTION: switch brief to rev 2 (16:9 landscape and acoustic guitar score) across all three bots.",
        );
        await expect.poll(() => Boolean(turn("L-ISSUE-REV2")), { timeout: 30_000 }).toBe(true);

        // Verify the single coordinate_bots call routed to all 3 states simultaneously:
        // - Researcher: outcome "injected" (steered into running turn)
        // - Art Director: outcome "injected" (answered parked NEEDS INPUT question)
        // - Producer: outcome "queued" (rework on standing thread)
        const [rev2Dispatch] = replies("L-ISSUE-REV2");
        expect(rev2Dispatch.receipts).toHaveLength(3);
        expect(rev2Dispatch.receipts.find((r: any) => r.botId === researcher.id)).toMatchObject({
          outcome: "injected",
        });
        expect(rev2Dispatch.receipts.find((r: any) => r.botId === artDirector.id)).toMatchObject({
          outcome: "injected",
          detail: expect.stringContaining("answered its question"),
        });
        expect(rev2Dispatch.receipts.find((r: any) => r.botId === producer.id)).toMatchObject({
          outcome: "queued",
        });

        // Release Researcher's gate now that the correction has been steered into its running turn
        writeFileSync(researcherGate, "open");
        await expect.poll(async () => await said(job, "L-REV2-FINAL"), { timeout: 30_000 }).toBe(1);
        await expect.poll(async () => await said(job, "L-PRE-REV2-SETTLED"), { timeout: 30_000 }).toBe(1);

        // Confirm each participant acknowledged Rev 2 once
        const researcherLatest = children().filter((c) => c.assignee.botId === researcher.id).at(-1)!;
        expect(researcherLatest.result).toContain(`ACK BRIEF rev 2 (${jobId})`);
        expect(researcherLatest.result).toContain(
          `REV2-CORRECTION [BRIEF rev 2 — ${jobId}]: Switch to 16:9 landscape and acoustic guitar score`,
        );

        const artDirectorLatest = children().filter((c) => c.assignee.botId === artDirector.id).at(-1)!;
        expect(artDirectorLatest.result).toContain(`ACK BRIEF rev 2 (${jobId})`);

        const producerLatest = children().filter((c) => c.assignee.botId === producer.id).at(-1)!;
        expect(producerLatest.result).toContain(`ACK BRIEF rev 2 (${jobId})`);

        // Verify F3 Deliverable Receipt attachments and show_html card on the job thread
        const rev2SettledEvidence = turn("L-REV2-SETTLED")?.evidence ?? [];
        const stepResults = rev2SettledEvidence.filter((e: any) => e?.step).map((e: any) => e.response.result);
        expect(stepResults).toHaveLength(5);
        expect(stepResults.every((r: any) => !r.isError)).toBe(true);

        const jobMessagesAfterRev2 = await messages(job);
        const attachedNames = jobMessagesAfterRev2.flatMap((m: any) => (m.attachments ?? []).map((a: any) => a.name));
        expect(attachedNames).toEqual(
          expect.arrayContaining([
            "brief.json",
            "deliverables.json",
            "deliverables-v1-vertical.txt",
            "deliverables-v2-landscape.txt",
          ]),
        );

        // Verify the rendered HTML receipt contains both versions with distinct briefRevision provenance and private/reviewed states
        expect(populatedReceiptHtml).toContain('"version": 1');
        expect(populatedReceiptHtml).toContain('"briefRevision": 1');
        expect(populatedReceiptHtml).toContain('"version": 2');
        expect(populatedReceiptHtml).toContain('"briefRevision": 2');
        expect(populatedReceiptHtml).toContain('"public": false');

        // -----------------------------------------------------------------------
        // PHASE C: Issue Brief Rev 3 with Producer deliberately OFFLINE (`failWith`),
        // proving the lead sees Researcher & Art Director acknowledged Rev 3 while
        // Producer is shown as un-acknowledged (`acknowledged: false`), and no bot's
        // permissions were widened across any revision.
        // -----------------------------------------------------------------------
        const briefRev3 = {
          ...briefRev2,
          currentRevision: 3,
          revisions: [
            ...briefRev2.revisions,
            {
              rev: 3,
              issuedAt: "2026-11-08T10:25:00.000Z",
              issuedBy: lead.id,
              supersedes: 2,
              summary: "CORRECTION: Add German subtitle track for DACH launch.",
              constraints: ["16:9 landscape", "DE subtitles", "do not publish externally"],
            },
          ],
          acknowledgements: {
            ...briefRev2.acknowledgements,
            "3": {
              [researcher.id]: { acknowledged: true, ackText: `ACK BRIEF rev 3 (${jobId})` },
              [artDirector.id]: { acknowledged: true, ackText: `ACK BRIEF rev 3 (${jobId})` },
              [producer.id]: { acknowledged: false, reason: "offline: Producer workstation unreachable" },
            },
          },
        };

        script(researcher.id, {
          key: "R-REV3",
          match: ["REV3-CORRECTION"],
          reply: `ACK BRIEF rev 3 (${jobId}): verified German DACH glossary under Brief rev 3.`,
        });
        script(artDirector.id, {
          key: "AD-REV3",
          match: ["REV3-CORRECTION"],
          reply: `ACK BRIEF rev 3 (${jobId}): approved lower-third subtitle safe area under Brief rev 3.`,
        });
        script(producer.id, {
          key: "P-OFFLINE-REV3",
          match: ["REV3-CORRECTION"],
          failWith: "Producer workstation offline (connection refused)",
        });
        script(
          lead.id,
          {
            key: "L-ISSUE-REV3",
            match: ["ISSUE-REV3-CORRECTION"],
            steps: [
              {
                arguments: {
                  bot_ids: [researcher.id, artDirector.id, producer.id],
                  in_my_folder: true,
                  rework: true,
                  message: `REV3-CORRECTION [BRIEF rev 3 — ${jobId}]: Add German subtitle track for DACH launch.`,
                },
              },
            ],
            writeFiles: {
              "brief.json": JSON.stringify(briefRev3, null, 2),
            },
            reply: "L-ISSUE-REV3: Dispatched Brief rev 3 to Researcher, Art Director, and Producer.",
          },
          {
            key: "L-REV3-SETTLED",
            match: [SETTLED, "ACK BRIEF rev 3", "Producer workstation offline"],
            reply:
              "L-REV3-FINAL: Researcher acknowledged (rev 3), Art Director acknowledged (rev 3), Producer UN-ACKNOWLEDGED (offline).",
          },
        );

        await say(lead.id, job, "ISSUE-REV3-CORRECTION: issue Brief rev 3 for German subtitles.");
        await expect.poll(async () => await said(job, "L-REV3-FINAL"), { timeout: 30_000 }).toBe(1);

        const rev3Children = children().slice(-3);
        expect(rev3Children.find((c) => c.assignee.botId === researcher.id)).toMatchObject({
          status: "completed",
          result: expect.stringContaining(`ACK BRIEF rev 3 (${jobId})`),
        });
        expect(rev3Children.find((c) => c.assignee.botId === artDirector.id)).toMatchObject({
          status: "completed",
          result: expect.stringContaining(`ACK BRIEF rev 3 (${jobId})`),
        });
        expect(rev3Children.find((c) => c.assignee.botId === producer.id)).toMatchObject({
          status: "failed",
          result: expect.stringContaining("Producer workstation offline"),
        });

        // Verify permissions and approval levels were never widened across any revision
        const currentBots = (await api("GET", "/api/bots?messages=0")).body.bots as any[];
        for (const participant of [researcher, artDirector, producer]) {
          const record = currentBots.find((b: any) => b.id === participant.id);
          expect(record.approvalMode).toBe("ask");
          expect(record.tasks.every((t: any) => t.approvalMode === "ask")).toBe(true);
          expect(turns(participant.id).every((t: any) => t.permissionMode === "default")).toBe(true);
        }

        // Verify no unplanned turns occurred
        expect(
          [lead.id, researcher.id, artDirector.id, producer.id]
            .flatMap((id) => turns(id))
            .filter((record) => record.unplanned)
            .map((record) => ownTurnText(record.prompt).slice(0, 300)),
        ).toEqual([]);
      } catch (error) {
        const planPath = join(dataDir, "room-plan.json");
        console.error(
          "fixture failure state:\n",
          JSON.stringify(
            {
              turns: jsonl(`${planPath}.evidence.jsonl`).map((record) => ({
                botId: record.botId,
                planKey: record.planKey,
                unplanned: record.unplanned,
                own: ownTurnText(record.prompt).slice(0, 400),
                stepOutcomes: (record.evidence ?? [])
                  .filter((e: any) => e?.step)
                  .map((e: any) => ({ tool: e.step.tool, response: e.response })),
              })),
              assignments: assignments(dataDir).map(({ id, parentId, status, outcome, result, question, assignee }) => ({
                id,
                parentId,
                botId: assignee?.botId,
                status,
                outcome,
                result,
                question,
              })),
            },
            null,
            2,
          ),
        );
        throw error;
      } finally {
        await session.close();
      }
    },
    hostTimeout(120_000),
  );
});
