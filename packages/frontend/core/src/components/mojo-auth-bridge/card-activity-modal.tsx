import { Modal } from '@affine/component';
import { CardActivityLogService } from '@affine/core/modules/card-activity';
import { useLiveData, useService } from '@toeverything/infra';
import { useEffect, useMemo, useState } from 'react';

import * as styles from './card-activity-modal.css';

function formatRelative(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function describeValue(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') {
    // Heuristic: large numbers are likely timestamps.
    if (v > 10 ** 12) return new Date(v).toLocaleDateString();
    return String(v);
  }
  if (Array.isArray(v)) return v.length === 0 ? '—' : `${v.length} item(s)`;
  return JSON.stringify(v);
}

interface CardActivityModalProps {
  rowId: string | null;
  onClose: () => void;
}

export const CardActivityModal = ({
  rowId,
  onClose,
}: CardActivityModalProps) => {
  const service = useService(CardActivityLogService);
  const entries$ = useMemo(
    () => (rowId ? service.entriesForRow$(rowId) : null),
    [rowId, service]
  );
  const entries = useLiveData(entries$ ?? null) ?? [];
  // Snapshot now at mount for relative timestamps; sampling Date.now in
  // render trips the react-hooks/purity rule.
  const [nowSnapshot] = useState(() => Date.now());

  return (
    <Modal
      open={!!rowId}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title="Card activity"
      width={520}
      contentOptions={{
        style: {
          maxHeight: '70vh',
          overflowY: 'auto',
        },
      }}
    >
      {entries.length === 0 ? (
        <div className={styles.empty}>
          No activity recorded for this card yet.
        </div>
      ) : (
        <ul className={styles.list}>
          {entries.map(entry => {
            const newValue = entry.details?.['newValue'];
            // Display order: "<actor name> <action> · <time>". Older
            // entries written before the actorName stamp landed will
            // have actorName=undefined; show "Someone" as a placeholder
            // rather than rendering a blank prefix.
            const actor = entry.actorName?.trim() || 'Someone';
            return (
              <li key={entry.id} className={styles.item}>
                <div className={styles.head}>
                  <span className={styles.action}>
                    <strong>{actor}</strong> {entry.action}
                  </span>
                  <span className={styles.time}>
                    {formatRelative(entry.timestamp, nowSnapshot)}
                  </span>
                </div>
                {newValue !== undefined && (
                  <div className={styles.body}>→ {describeValue(newValue)}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
};

/**
 * Listens for the global "mojo-card-activity" event fired from the
 * BlockSuite kanban card menu and opens a modal scoped to that row.
 */
export const CardActivityModalListener = () => {
  const [rowId, setRowId] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ rowId?: string }>).detail;
      if (detail?.rowId) setRowId(detail.rowId);
    };
    document.addEventListener('mojo-card-activity', handler);
    return () => document.removeEventListener('mojo-card-activity', handler);
  }, []);

  return <CardActivityModal rowId={rowId} onClose={() => setRowId(null)} />;
};
