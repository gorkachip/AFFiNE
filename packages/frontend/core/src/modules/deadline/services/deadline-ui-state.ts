import { LiveData, Service } from '@toeverything/infra';
import { map } from 'rxjs';

import { type WorkspaceDBService } from '../../db';
import { type DocsService } from '../../doc';
import { type WorkspaceService } from '../../workspace';

function readMojoAuth(): { userId?: string; userName?: string } {
  const bridge = (
    globalThis as unknown as {
      __mojoAuthContext?: { userId: string | null; userName?: string | null };
    }
  ).__mojoAuthContext;
  return {
    userId: bridge?.userId ?? undefined,
    userName: bridge?.userName ?? undefined,
  };
}

function logToCardActivity(entry: {
  docId: string;
  rowId: string;
  action: string;
  details?: Record<string, unknown>;
}) {
  const bridge = (
    globalThis as unknown as {
      __mojoCardActivityLog?: {
        add: (e: {
          rowId: string;
          docId: string;
          actorId?: string;
          actorName?: string;
          action: string;
          details?: Record<string, unknown>;
        }) => void;
      };
    }
  ).__mojoCardActivityLog;
  if (!bridge) return;
  const { userId, userName } = readMojoAuth();
  bridge.add({
    rowId: entry.rowId,
    docId: entry.docId,
    actorId: userId,
    actorName: userName,
    action: entry.action,
    details: entry.details,
  });
}

function parseEntryId(id: string): { docId: string; rowId: string } | null {
  // Composite key shape is `${docId}:${rowId}`; rowIds are nanoid
  // (no colons) so the first segment is always the doc id.
  const sep = id.indexOf(':');
  if (sep <= 0) return null;
  return { docId: id.slice(0, sep), rowId: id.slice(sep + 1) };
}

interface PerEntryState {
  done?: boolean;
  snoozedUntil?: number;
}

// Loose type for the BlockSuite database model — we only need to
// read columns/cells, not pull in @blocksuite types from another
// package boundary.
interface DatabaseLikeModel {
  children?: { id: string }[];
  props: {
    // eslint-disable-next-line rxjs/finnish
    columns$: { value: { id: string; type: string }[] };
    cells: Record<
      string,
      Record<string, { columnId: string; value: unknown } | undefined>
    >;
  };
}

type StateMap = Record<string, PerEntryState>;

const STORAGE_PREFIX = 'mojo:deadlines-ui-state:';

/**
 * MOJO: per-deadline UI state (`done` flag and snooze timestamp)
 * shared across the workspace via the `deadlineState` table. Lives
 * in its own table so the previous attempt to extend the `deadlines`
 * table itself (which crashed boot for clients with existing data)
 * stays reverted.
 *
 * Reads stream from the table so changes propagate live to every
 * member's open page. Writes go straight to the table; the prior
 * localStorage state is migrated once on construction so the user
 * doesn't lose what they had before sync existed.
 */
export class DeadlineUiStateService extends Service {
  states$ = LiveData.from<StateMap>(
    this.db.db.deadlineState.find$().pipe(
      map(rows => {
        const result: StateMap = {};
        for (const row of rows) {
          if (!row.id) continue;
          const entry: PerEntryState = {};
          if (row.done) entry.done = true;
          if (row.snoozedUntil != null) {
            entry.snoozedUntil = Number(row.snoozedUntil);
          }
          if (entry.done || entry.snoozedUntil != null) {
            result[row.id] = entry;
          }
        }
        return result;
      })
    ),
    {}
  );

  constructor(
    private readonly db: WorkspaceDBService,
    private readonly workspaceService: WorkspaceService,
    private readonly docsService: DocsService
  ) {
    super();
    queueMicrotask(() => this.migrateLegacyLocalStorage());
  }

  /**
   * Push the kanban card's actual deadline cell forward by `days`
   * from today. Unlike snooze (which only flips the local UI state),
   * this opens the doc, edits the deadline cell directly, and
   * mirrors the change into the workspace deadlines index so other
   * members see the new date too.
   *
   * Falls back gracefully when the doc / database / deadline column
   * can't be located — the local snooze stays active so the user
   * still gets the row out of Overdue.
   */
  async extendCardDeadline(entryId: string, days: number): Promise<boolean> {
    const parts = parseEntryId(entryId);
    if (!parts) return false;
    const today = Date.now();
    const newTimestamp = today + days * 24 * 60 * 60 * 1000;

    let release: (() => void) | undefined;
    let oldValue: number | undefined;
    let success = false;
    try {
      const opened = this.docsService.open(parts.docId);
      release = opened.release;
      const doc = opened.doc;
      const dispose = doc.addPriorityLoad(10);
      await doc.waitForSyncReady();
      dispose();

      const bsDoc = doc.blockSuiteDoc;
      const databaseModels = bsDoc
        .getBlocksByFlavour('affine:database')
        .map(block => block.model as unknown as DatabaseLikeModel)
        .filter(Boolean);
      const target = databaseModels.find(model =>
        model.children?.some(child => child.id === parts.rowId)
      );
      if (!target) return false;
      const cols = target.props?.columns$?.value ?? [];
      const deadlineCol = cols.find(c => c.type === 'deadline');
      if (!deadlineCol) return false;

      bsDoc.transact(() => {
        const cells = target.props.cells;
        const existing = cells[parts.rowId]?.[deadlineCol.id];
        if (typeof existing?.value === 'number') {
          oldValue = existing.value;
        }
        if (!cells[parts.rowId]) {
          cells[parts.rowId] = Object.create(null);
        }
        cells[parts.rowId][deadlineCol.id] = {
          columnId: deadlineCol.id,
          value: newTimestamp,
        };
      });
      success = true;
    } catch (e) {
      console.warn('[mojo deadline] extendCardDeadline failed', {
        entryId,
        error: e,
      });
    } finally {
      release?.();
    }

    if (success) {
      // Mirror the change into the workspace deadlines index so the
      // /deadlines list updates immediately — the data-source's own
      // bridge upsert won't fire unless someone is rendering this
      // doc's kanban right now.
      try {
        this.db.db.deadlines.update(entryId, { deadline: newTimestamp });
      } catch {
        // ignore — next bootstrap scan will create/sync the row
      }
      // Snooze becomes redundant once the underlying card has the
      // new date; clear it so the row doesn't double-shift.
      this.upsert(entryId, { snoozedUntil: undefined });
      logToCardActivity({
        docId: parts.docId,
        rowId: parts.rowId,
        action: `Extended deadline ${days}d`,
        details: {
          oldValue: oldValue
            ? new Date(oldValue).toISOString().slice(0, 10)
            : undefined,
          newValue: new Date(newTimestamp).toISOString().slice(0, 10),
          days,
        },
      });
    }
    return success;
  }

  isDone(id: string): boolean {
    return !!this.states$.value[id]?.done;
  }

  getSnoozedUntil(id: string): number | undefined {
    return this.states$.value[id]?.snoozedUntil;
  }

  markDone(id: string, done: boolean) {
    this.upsert(id, { done: done || undefined });
    const parts = parseEntryId(id);
    if (parts) {
      logToCardActivity({
        ...parts,
        action: done ? 'Marked deadline done' : 'Reopened deadline',
      });
    }
  }

  /**
   * Push the deadline forward by `days` from today (NOT from the
   * existing date). Snooze buttons only appear on overdue entries, so
   * the user's mental model is "+3 days from now" — extending past
   * the already-overdue date would still leave it overdue.
   */
  snoozeByDays(id: string, days: number, currentEffective?: number) {
    const today = Date.now();
    const snoozedUntil = today + days * 24 * 60 * 60 * 1000;
    this.upsert(id, { snoozedUntil });
    const parts = parseEntryId(id);
    if (parts) {
      logToCardActivity({
        ...parts,
        action: `Snoozed deadline ${days}d`,
        details: {
          oldValue: currentEffective
            ? new Date(currentEffective).toISOString().slice(0, 10)
            : undefined,
          newValue: new Date(snoozedUntil).toISOString().slice(0, 10),
          days,
        },
      });
    }
  }

  snoozeUntil(id: string, until: number) {
    this.upsert(id, { snoozedUntil: until });
    const parts = parseEntryId(id);
    if (parts) {
      logToCardActivity({
        ...parts,
        action: 'Snoozed deadline',
        details: {
          newValue: new Date(until).toISOString().slice(0, 10),
        },
      });
    }
  }

  clearSnooze(id: string) {
    this.upsert(id, { snoozedUntil: undefined });
    const parts = parseEntryId(id);
    if (parts) {
      logToCardActivity({
        ...parts,
        action: 'Cleared deadline snooze',
      });
    }
  }

  private upsert(id: string, patch: PerEntryState) {
    const userId = readMojoAuth().userId;
    const now = Date.now();
    const existing = this.db.db.deadlineState.get(id);
    // Spread merges existing onto patch — but we need patch's
    // `undefined` values to actually CLEAR the field, which `update()`
    // refuses to do (the ORM validator strips undefined keys from the
    // payload, leaving stale state behind). So compute the effective
    // value field-by-field, then delete + create the row when the
    // patch clears something.
    const merged: PerEntryState = {
      done: 'done' in patch ? patch.done : (existing?.done ?? undefined),
      snoozedUntil:
        'snoozedUntil' in patch
          ? patch.snoozedUntil
          : existing?.snoozedUntil != null
            ? Number(existing.snoozedUntil)
            : undefined,
    };
    if (!merged.done && merged.snoozedUntil == null) {
      if (existing) {
        try {
          this.db.db.deadlineState.delete(id);
        } catch {
          // ignore — row may already be gone
        }
      }
      return;
    }
    // Recreate the row from scratch so cleared fields actually
    // disappear from the underlying YMap.
    if (existing) {
      try {
        this.db.db.deadlineState.delete(id);
      } catch {
        // ignore
      }
    }
    try {
      this.db.db.deadlineState.create({
        id,
        done: merged.done || undefined,
        snoozedUntil: merged.snoozedUntil ?? undefined,
        updatedBy: userId ?? undefined,
        updatedAt: now,
      });
    } catch (e) {
      console.warn('[mojo deadline state] create failed', { id, error: e });
    }
  }

  /**
   * One-shot migration: pulls anything the user accumulated in
   * localStorage (the v1 implementation) into the workspace table so
   * marks/snoozes set before sync existed don't disappear. Runs once
   * per workspace and clears the localStorage key when done.
   */
  private migrateLegacyLocalStorage() {
    if (typeof window === 'undefined') return;
    const key = `${STORAGE_PREFIX}${this.workspaceService.workspace.id}`;
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return;
    }
    if (!raw) return;
    let parsed: StateMap;
    try {
      parsed = JSON.parse(raw) as StateMap;
    } catch {
      return;
    }
    for (const [id, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== 'object') continue;
      if (this.db.db.deadlineState.get(id)) continue;
      this.upsert(id, {
        done: entry.done || undefined,
        snoozedUntil:
          typeof entry.snoozedUntil === 'number'
            ? entry.snoozedUntil
            : undefined,
      });
    }
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}
