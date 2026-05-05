import { Header } from '@affine/core/components/pure/header';
import { AuthService } from '@affine/core/modules/cloud';
import {
  type DeadlineEntry,
  DeadlineIndexService,
  DeadlineUiStateService,
} from '@affine/core/modules/deadline';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { DateTimeIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useMemo, useState } from 'react';

import {
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewTitle,
} from '../../../modules/workbench';
import * as styles from './deadlines-page.css';

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

type Bucket = 'Overdue' | 'Today' | 'Tomorrow' | 'This week' | 'Upcoming';

function bucketFor(deadline: number, todayStart: number): Bucket {
  const day = 24 * 60 * 60 * 1000;
  const diff = startOfDay(deadline) - todayStart;
  if (diff < 0) return 'Overdue';
  if (diff === 0) return 'Today';
  if (diff === day) return 'Tomorrow';
  if (diff <= 7 * day) return 'This week';
  return 'Upcoming';
}

const ACTIVE_BUCKET_ORDER: Bucket[] = [
  'Overdue',
  'Today',
  'Tomorrow',
  'This week',
  'Upcoming',
];

function effectiveDeadline(
  entry: DeadlineEntry,
  states: Record<string, { snoozedUntil?: number }>
): number {
  const snoozed = states[entry.id]?.snoozedUntil;
  if (snoozed && snoozed > entry.deadline) return snoozed;
  return entry.deadline;
}

export const DeadlinesPage = () => {
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

  const { active, done } = useMemo(() => {
    const todayStart = startOfDay(nowSnapshot);
    const activeBuckets: Record<Bucket, DeadlineEntry[]> = {
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
      activeBuckets[key].push(entry);
    }
    for (const key of Object.keys(activeBuckets) as Bucket[]) {
      activeBuckets[key].sort(
        (a, b) => effectiveDeadline(a, states) - effectiveDeadline(b, states)
      );
    }
    doneList.sort(
      (a, b) => effectiveDeadline(b, states) - effectiveDeadline(a, states)
    );
    return { active: activeBuckets, done: doneList };
  }, [visible, nowSnapshot, states]);

  const handleOpen = useCallback(
    (entry: DeadlineEntry) => {
      // MOJO: park the row id in a global so the kanban that mounts on
      // the destination doc auto-opens its detail panel — otherwise the
      // user lands on the kanban scroll and has to find the card.
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
      uiState.snoozeByDays(entry.id, days, effectiveDeadline(entry, states));
    },
    [uiState, states]
  );

  const isEmpty = visible.length === 0;

  return (
    <>
      <ViewTitle title="Deadlines" />
      <ViewIcon icon="journal" />
      <ViewHeader>
        <Header
          left={
            <div className={styles.title}>
              <DateTimeIcon className={styles.titleIcon} />
              Deadlines
            </div>
          }
        />
      </ViewHeader>
      <ViewBody>
        <div className={styles.body}>
          {isEmpty && (
            <div className={styles.empty}>No deadlines assigned to you.</div>
          )}
          {!isEmpty &&
            ACTIVE_BUCKET_ORDER.map(bucket => {
              const items = active[bucket];
              if (items.length === 0) return null;
              return (
                <DeadlineSection
                  key={bucket}
                  title={bucket}
                  entries={items}
                  states={states}
                  variant={bucket === 'Overdue' ? 'overdue' : 'active'}
                  onOpen={handleOpen}
                  onMarkDone={handleMarkDone}
                  onSnooze={handleSnooze}
                />
              );
            })}
          {done.length > 0 && (
            <DeadlineSection
              title="Done"
              entries={done}
              states={states}
              variant="done"
              onOpen={handleOpen}
              onMarkDone={handleMarkDone}
              onSnooze={handleSnooze}
            />
          )}
        </div>
      </ViewBody>
    </>
  );
};

interface DeadlineSectionProps {
  title: string;
  entries: DeadlineEntry[];
  states: Record<string, { snoozedUntil?: number; done?: boolean }>;
  variant: 'overdue' | 'active' | 'done';
  onOpen: (entry: DeadlineEntry) => void;
  onMarkDone: (entry: DeadlineEntry, done: boolean) => void;
  onSnooze: (entry: DeadlineEntry, days: number) => void;
}

const DeadlineSection = ({
  title,
  entries,
  states,
  variant,
  onOpen,
  onMarkDone,
  onSnooze,
}: DeadlineSectionProps) => {
  return (
    <section className={styles.bucket}>
      <h3 className={styles.bucketHeader}>
        {title}
        <span className={styles.bucketCount}>{entries.length}</span>
      </h3>
      <ul className={styles.list}>
        {entries.map(entry => (
          <DeadlineRow
            key={entry.id}
            entry={entry}
            states={states}
            variant={variant}
            onOpen={onOpen}
            onMarkDone={onMarkDone}
            onSnooze={onSnooze}
          />
        ))}
      </ul>
    </section>
  );
};

interface DeadlineRowProps {
  entry: DeadlineEntry;
  states: Record<string, { snoozedUntil?: number; done?: boolean }>;
  variant: 'overdue' | 'active' | 'done';
  onOpen: (entry: DeadlineEntry) => void;
  onMarkDone: (entry: DeadlineEntry, done: boolean) => void;
  onSnooze: (entry: DeadlineEntry, days: number) => void;
}

const DeadlineRow = ({
  entry,
  states,
  variant,
  onOpen,
  onMarkDone,
  onSnooze,
}: DeadlineRowProps) => {
  const effective = effectiveDeadline(entry, states);
  const isSnoozed = effective !== entry.deadline;
  const dateLabel = `${new Date(effective).toLocaleDateString()}${
    isSnoozed ? ' (snoozed)' : ''
  }`;

  const stopThen = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <li
      className={`${styles.row}${variant === 'done' ? ` ${styles.rowDone}` : ''}`}
      onClick={() => onOpen(entry)}
    >
      <span
        className={`${styles.cardTitle}${
          variant === 'done' ? ` ${styles.cardTitleStrike}` : ''
        }`}
      >
        {entry.title || 'Untitled card'}
      </span>
      <span
        className={`${styles.cardDate}${
          variant === 'overdue' ? ` ${styles.cardDateOverdue}` : ''
        }${isSnoozed ? ` ${styles.cardDateSnoozed}` : ''}`}
      >
        {dateLabel}
      </span>
      <div className={styles.rowActions}>
        {variant === 'overdue' && (
          <>
            <button
              type="button"
              className={styles.actionButton}
              title="Snooze 1 day"
              onClick={stopThen(() => onSnooze(entry, 1))}
            >
              +1d
            </button>
            <button
              type="button"
              className={styles.actionButton}
              title="Snooze 3 days"
              onClick={stopThen(() => onSnooze(entry, 3))}
            >
              +3d
            </button>
            <button
              type="button"
              className={styles.actionButton}
              title="Snooze 1 week"
              onClick={stopThen(() => onSnooze(entry, 7))}
            >
              +1w
            </button>
          </>
        )}
        {variant !== 'done' && (
          <button
            type="button"
            className={styles.actionButtonPrimary}
            onClick={stopThen(() => onMarkDone(entry, true))}
          >
            Mark done
          </button>
        )}
        {variant === 'done' && (
          <button
            type="button"
            className={styles.actionButton}
            onClick={stopThen(() => onMarkDone(entry, false))}
          >
            Reopen
          </button>
        )}
      </div>
    </li>
  );
};

export const Component = () => <DeadlinesPage />;
