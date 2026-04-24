import { LiveData, Service } from '@toeverything/infra';

import type { WorkspaceDBService } from '../../db';

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
 */
export class DeadlineIndexService extends Service {
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
        this.db.db.deadlines.create({
          id,
          docId: entry.docId,
          rowId: entry.rowId,
          deadline: entry.deadline,
          createdBy: entry.createdBy,
          memberIds: JSON.stringify(entry.memberIds),
          title: entry.title,
        });
      },
      remove: (docId, rowId) => {
        const id = `${docId}:${rowId}`;
        try {
          this.db.db.deadlines.delete(id);
        } catch {
          // entry might not exist if the row never had a deadline
        }
      },
    };
  }

  deadlines$ = LiveData.from<DeadlineEntry[]>(
    this.db.db.deadlines.find$({}).map(rows =>
      rows.map(row => ({
        id: row.id,
        docId: row.docId ?? '',
        rowId: row.rowId ?? '',
        deadline: Number(row.deadline ?? 0),
        createdBy: row.createdBy ?? undefined,
        memberIds: row.memberIds ? safeParseArray(row.memberIds) : [],
        title: row.title ?? '',
      }))
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
