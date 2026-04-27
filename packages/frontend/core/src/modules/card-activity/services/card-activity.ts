import { LiveData, OnEvent, Service } from '@toeverything/infra';
import { map } from 'rxjs';

import type { WorkspaceDBService } from '../../db';
import { type Workspace, WorkspaceInitialized } from '../../workspace';

export interface CardActivityEntry {
  id: string;
  rowId: string;
  docId: string;
  timestamp: number;
  actorId?: string;
  actorName?: string;
  action: string;
  details?: Record<string, unknown>;
}

/**
 * Per-card activity log. Eagerly instantiated so the bridge is in
 * place before any kanban edit happens.
 */
@OnEvent(WorkspaceInitialized, i => i.onWorkspaceInitialized)
export class CardActivityLogService extends Service {
  onWorkspaceInitialized(_workspace: Workspace) {
    /* bridge installs in constructor */
  }

  constructor(private readonly db: WorkspaceDBService) {
    super();

    (
      globalThis as unknown as {
        __mojoCardActivityLog?: {
          add: (entry: {
            rowId: string;
            docId: string;
            actorId?: string;
            actorName?: string;
            action: string;
            details?: Record<string, unknown>;
          }) => void;
        };
      }
    ).__mojoCardActivityLog = {
      add: entry => {
        try {
          this.db.db.cardActivityLog.create({
            rowId: entry.rowId,
            docId: entry.docId,
            timestamp: Date.now(),
            actorId: entry.actorId,
            actorName: entry.actorName,
            action: entry.action,
            details: entry.details ? JSON.stringify(entry.details) : undefined,
          });
        } catch (err) {
          console.warn('[mojo card-activity] add failed', err);
        }
      },
    };
  }

  entriesForRow$(rowId: string): LiveData<CardActivityEntry[]> {
    return LiveData.from<CardActivityEntry[]>(
      this.db.db.cardActivityLog.find$({ rowId }).pipe(
        map(rows => {
          const list = rows.map(row => ({
            id: row.id,
            rowId: row.rowId ?? '',
            docId: row.docId ?? '',
            timestamp: Number(row.timestamp ?? 0),
            actorId: row.actorId ?? undefined,
            actorName: row.actorName ?? undefined,
            action: row.action ?? '',
            details: row.details ? safeParseObject(row.details) : undefined,
          }));
          // Newest first.
          return list.sort((a, b) => b.timestamp - a.timestamp);
        })
      ),
      []
    );
  }
}

function safeParseObject(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}
