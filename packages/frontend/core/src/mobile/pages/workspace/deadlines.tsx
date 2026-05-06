import { SafeArea, useThemeColorV2 } from '@affine/component';
import { AuthService } from '@affine/core/modules/cloud';
import {
  type DeadlineEntry,
  DeadlineIndexService,
  DeadlineUiStateService,
} from '@affine/core/modules/deadline';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { useLiveData, useService } from '@toeverything/infra';
import { cssVarV2 } from '@toeverything/theme/v2';
import { useCallback, useMemo, useState } from 'react';

import { AppTabs, PageHeader } from '../../components';

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketFor(deadline: number, todayStart: number): string {
  const day = 24 * 60 * 60 * 1000;
  const diff = startOfDay(deadline) - todayStart;
  if (diff < 0) return 'Overdue';
  if (diff === 0) return 'Today';
  if (diff === day) return 'Tomorrow';
  if (diff <= 7 * day) return 'This week';
  return 'Upcoming';
}

const BUCKET_ORDER = [
  'Overdue',
  'Today',
  'Tomorrow',
  'This week',
  'Upcoming',
] as const;

function effectiveDeadline(
  entry: DeadlineEntry,
  states: Record<string, { snoozedUntil?: number }>
): number {
  const snoozed = states[entry.id]?.snoozedUntil;
  if (snoozed && snoozed > entry.deadline) return snoozed;
  return entry.deadline;
}

export const DeadlinesPage = () => {
  useThemeColorV2('layer/background/mobile/primary');

  const deadlineIndex = useService(DeadlineIndexService);
  const uiState = useService(DeadlineUiStateService);
  const authService = useService(AuthService);
  const workbench = useService(WorkbenchService).workbench;

  const all = useLiveData(deadlineIndex.deadlines$);
  const states = useLiveData(uiState.states$);
  const currentUserId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );
  const [nowSnapshot] = useState(() => Date.now());

  const visible = useMemo(() => {
    if (!currentUserId) return [];
    return all.filter(
      entry =>
        entry.createdBy === currentUserId ||
        entry.memberIds.includes(currentUserId)
    );
  }, [all, currentUserId]);

  const { grouped, doneEntries } = useMemo(() => {
    const todayStart = startOfDay(nowSnapshot);
    const buckets: Record<string, DeadlineEntry[]> = {
      Overdue: [],
      Today: [],
      Tomorrow: [],
      'This week': [],
      Upcoming: [],
    };
    const doneList: DeadlineEntry[] = [];
    for (const entry of visible) {
      if (states[entry.id]?.done) {
        doneList.push(entry);
        continue;
      }
      const effective = effectiveDeadline(entry, states);
      const key = bucketFor(effective, todayStart);
      buckets[key]?.push(entry);
    }
    for (const key of Object.keys(buckets)) {
      buckets[key].sort(
        (a, b) => effectiveDeadline(a, states) - effectiveDeadline(b, states)
      );
    }
    doneList.sort(
      (a, b) => effectiveDeadline(b, states) - effectiveDeadline(a, states)
    );
    return { grouped: buckets, doneEntries: doneList };
  }, [visible, nowSnapshot, states]);

  const handleOpen = useCallback(
    (entry: DeadlineEntry) => {
      // MOJO: tell the kanban that's about to mount which row to pop
      // open as a detail panel, so the user doesn't land on a kanban
      // scroll they have to hunt through.
      (
        globalThis as unknown as {
          __mojoOpenKanbanCard?: { docId?: string; rowId?: string };
        }
      ).__mojoOpenKanbanCard = { docId: entry.docId, rowId: entry.rowId };
      workbench.openDoc(
        { docId: entry.docId, databaseRowId: entry.rowId },
        { at: 'active' }
      );
    },
    [workbench]
  );

  const handleMarkDone = useCallback(
    (entry: DeadlineEntry, done: boolean) => {
      uiState.markDone(entry.id, done);
    },
    [uiState]
  );

  const handleSnooze = useCallback(
    (entry: DeadlineEntry, days: number) => {
      // MOJO: extend the actual kanban card's deadline so all members
      // see the new date. Local snooze is only a fallback.
      const fallback = () =>
        uiState.snoozeByDays(entry.id, days, effectiveDeadline(entry, states));
      uiState
        .extendCardDeadline(entry.id, days)
        .then(applied => {
          if (!applied) fallback();
        })
        .catch(() => fallback());
    },
    [uiState, states]
  );

  const isEmpty = visible.length === 0;

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: cssVarV2('layer/background/mobile/primary'),
        }}
      >
        <PageHeader back contentClassName="mobile-deadlines-header-content">
          Deadlines
        </PageHeader>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 16px 96px 16px',
          }}
        >
          {isEmpty ? (
            <div
              style={{
                padding: '40px 16px',
                color: cssVarV2('text/secondary'),
                textAlign: 'center',
                fontSize: 15,
              }}
            >
              No deadlines assigned to you.
            </div>
          ) : (
            BUCKET_ORDER.map(bucket => {
              const items = grouped[bucket];
              if (!items || items.length === 0) return null;
              return (
                <section key={bucket} style={{ marginBottom: 24 }}>
                  <h3
                    style={{
                      margin: '0 0 8px 0',
                      fontSize: 14,
                      fontWeight: 600,
                      color: cssVarV2('text/secondary'),
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    {bucket}
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: cssVarV2('text/tertiary'),
                      }}
                    >
                      {items.length}
                    </span>
                  </h3>
                  <ul
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {items.map(entry => (
                      <MobileDeadlineRow
                        key={entry.id}
                        entry={entry}
                        states={states}
                        isOverdue={bucket === 'Overdue'}
                        done={false}
                        onOpen={handleOpen}
                        onMarkDone={handleMarkDone}
                        onSnooze={handleSnooze}
                      />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
          {doneEntries.length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <h3
                style={{
                  margin: '0 0 8px 0',
                  fontSize: 14,
                  fontWeight: 600,
                  color: cssVarV2('text/secondary'),
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                Done
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: cssVarV2('text/tertiary'),
                  }}
                >
                  {doneEntries.length}
                </span>
              </h3>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {doneEntries.map(entry => (
                  <MobileDeadlineRow
                    key={entry.id}
                    entry={entry}
                    states={states}
                    isOverdue={false}
                    done
                    onOpen={handleOpen}
                    onMarkDone={handleMarkDone}
                    onSnooze={handleSnooze}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      <SafeArea bottom>
        <AppTabs background={cssVarV2('layer/background/mobile/primary')} />
      </SafeArea>
    </>
  );
};

interface MobileDeadlineRowProps {
  entry: DeadlineEntry;
  states: Record<string, { snoozedUntil?: number; done?: boolean }>;
  isOverdue: boolean;
  done: boolean;
  onOpen: (entry: DeadlineEntry) => void;
  onMarkDone: (entry: DeadlineEntry, done: boolean) => void;
  onSnooze: (entry: DeadlineEntry, days: number) => void;
}

const MobileDeadlineRow = ({
  entry,
  states,
  isOverdue,
  done,
  onOpen,
  onMarkDone,
  onSnooze,
}: MobileDeadlineRowProps) => {
  const effective = effectiveDeadline(entry, states);
  const isSnoozed = effective !== entry.deadline;

  const stopThen = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  const buttonStyle: React.CSSProperties = {
    border: 'none',
    background: cssVarV2('layer/background/hoverOverlay'),
    color: cssVarV2('text/primary'),
    fontSize: 12,
    padding: '6px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    flexShrink: 0,
  };

  return (
    <li
      onClick={() => onOpen(entry)}
      style={{
        padding: 12,
        borderRadius: 10,
        background: cssVarV2('layer/background/mobile/secondary'),
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        opacity: done ? 0.55 : 1,
      }}
    >
      <span
        style={{
          fontSize: 15,
          fontWeight: 500,
          color: cssVarV2('text/primary'),
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textDecoration: done ? 'line-through' : undefined,
        }}
      >
        {entry.title || 'Untitled card'}
      </span>
      <span
        style={{
          fontSize: 13,
          color: isOverdue
            ? cssVarV2('button/error')
            : cssVarV2('text/secondary'),
          fontWeight: isOverdue ? 600 : undefined,
          fontStyle: isSnoozed ? 'italic' : undefined,
        }}
      >
        {new Date(effective).toLocaleDateString()}
        {isSnoozed ? ' (snoozed)' : ''}
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {isOverdue && (
          <>
            <button
              type="button"
              onClick={stopThen(() => onSnooze(entry, 1))}
              style={buttonStyle}
            >
              +1d
            </button>
            <button
              type="button"
              onClick={stopThen(() => onSnooze(entry, 3))}
              style={buttonStyle}
            >
              +3d
            </button>
            <button
              type="button"
              onClick={stopThen(() => onSnooze(entry, 7))}
              style={buttonStyle}
            >
              +1w
            </button>
          </>
        )}
        {!done && (
          <button
            type="button"
            onClick={stopThen(() => onMarkDone(entry, true))}
            style={{
              ...buttonStyle,
              color: cssVarV2('button/primary'),
              fontWeight: 500,
            }}
          >
            Mark done
          </button>
        )}
        {done && (
          <button
            type="button"
            onClick={stopThen(() => onMarkDone(entry, false))}
            style={buttonStyle}
          >
            Reopen
          </button>
        )}
      </div>
    </li>
  );
};

export const Component = () => <DeadlinesPage />;
