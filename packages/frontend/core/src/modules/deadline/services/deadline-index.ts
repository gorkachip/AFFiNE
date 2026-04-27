import { LiveData, OnEvent, Service } from '@toeverything/infra';
import { map } from 'rxjs';

import type { WorkspaceDBService } from '../../db';
import { type Workspace, WorkspaceInitialized } from '../../workspace';

export interface DeadlineEntry {
  id: string; // `${docId}:${rowId}`
  docId: string;
  rowId: string;
  deadline: number;
  createdBy?: string;
  memberIds: string[];
  title: string;
}

/**
 * Workspace-scoped index of every deadline currently set on a kanban card.
 * Written by the BlockSuite database data-source through a small global
 * bridge (`globalThis.__mojoDeadlineIndex`) so the vendored database block
 * doesn't need to import AFFiNE services.
 *
 * Eagerly instantiated on workspace init so the bridge is in place before
 * the user opens any kanban — otherwise edits done during the cold path
 * silently no-op against an undefined bridge.
 */
@OnEvent(WorkspaceInitialized, i => i.onWorkspaceInitialized)
export class DeadlineIndexService extends Service {
  onWorkspaceInitialized(_workspace: Workspace) {
    // Bridge is installed in the constructor; this hook just guarantees
    // the service gets created even when nothing has called useService
    // for it yet.
  }

  constructor(private readonly db: WorkspaceDBService) {
    super();

    // Install the bridge as soon as the service boots. The data-source
    // calls .upsert / .remove as rows mutate. If the bridge isn't set
    // (tests, sync worker) the data-source falls through silently.
    (
      globalThis as unknown as {
        __mojoDeadlineIndex?: {
          upsert: (entry: {
            docId: string;
            rowId: string;
            deadline: number;
            createdBy?: string;
            memberIds: string[];
            title: string;
          }) => void;
          remove: (docId: string, rowId: string) => void;
        };
      }
    ).__mojoDeadlineIndex = {
      upsert: entry => {
        const id = `${entry.docId}:${entry.rowId}`;

        console.log('[mojo deadline] upsert', id, entry);
        try {
          this.db.db.deadlines.create({
            id,
            docId: entry.docId,
            rowId: entry.rowId,
            deadline: entry.deadline,
            createdBy: entry.createdBy,
            memberIds: JSON.stringify(entry.memberIds),
            title: entry.title,
          });
        } catch (createErr) {
          // Most likely a duplicate id — try update.
          try {
            this.db.db.deadlines.update(id, {
              docId: entry.docId,
              rowId: entry.rowId,
              deadline: entry.deadline,
              createdBy: entry.createdBy,
              memberIds: JSON.stringify(entry.memberIds),
              title: entry.title,
            });
          } catch (updateErr) {
            console.warn('[mojo deadline] upsert failed', {
              createErr,
              updateErr,
            });
          }
        }
      },
      remove: (docId, rowId) => {
        const id = `${docId}:${rowId}`;

        console.log('[mojo deadline] remove', id);
        try {
          this.db.db.deadlines.delete(id);
        } catch {
          // entry might not exist if the row never had a deadline
        }
      },
    };

    console.log('[mojo deadline] bridge installed', {
      bridge: !!(globalThis as any).__mojoDeadlineIndex,
    });
  }

  deadlines$ = LiveData.from<DeadlineEntry[]>(
    // find$() with no filter returns every row; passing {} would be
    // interpreted as "match every field equals empty" and yield nothing.
    this.db.db.deadlines.find$().pipe(
      map(rows => {
         
        console.log('[mojo deadline] deadlines$ emit', rows.length, rows);
        return rows.map(row => ({
          id: row.id,
          docId: row.docId ?? '',
          rowId: row.rowId ?? '',
          deadline: Number(row.deadline ?? 0),
          createdBy: row.createdBy ?? undefined,
          memberIds: row.memberIds ? safeParseArray(row.memberIds) : [],
          title: row.title ?? '',
        }));
      })
    ),
    []
  );
}

function safeParseArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(x => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}
