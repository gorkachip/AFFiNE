import { Header } from '@affine/core/components/pure/header';
import { AuthService } from '@affine/core/modules/cloud';
import {
  type DeadlineEntry,
  DeadlineIndexService,
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

export const DeadlinesPage = () => {
  const deadlineIndex = useService(DeadlineIndexService);
  const authService = useService(AuthService);
  const workbench = useService(WorkbenchService).workbench;

  const all = useLiveData(deadlineIndex.deadlines$);
  const currentUserId = useLiveData(
    authService.session.account$.map(a => a?.id ?? null)
  );

  // Snapshot "now" at mount — the page re-renders often enough (on data
  // changes) that a stale reading here is harmless, and sampling Date.now
  // inside render would trip the react-hooks/purity rule.
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
      if (entry.done) {
        doneList.push(entry);
        continue;
      }
      const effective = DeadlineIndexService.effectiveDeadline(entry);
      const key = bucketFor(effective, todayStart);
      activeBuckets[key].push(entry);
    }
    for (const key of Object.keys(activeBuckets) as Bucket[]) {
      activeBuckets[key].sort(
        (a, b) =>
          DeadlineIndexService.effectiveDeadline(a) -
          DeadlineIndexService.effectiveDeadline(b)
      );
    }
    // Most recently completed first.
    doneList.sort(
      (a, b) =>
        DeadlineIndexService.effectiveDeadline(b) -
        DeadlineIndexService.effectiveDeadline(a)
    );
    return { active: activeBuckets, done: doneList };
  }, [visible, nowSnapshot]);

  const handleOpen = useCallback(
    (entry: DeadlineEntry) => {
      // Pass databaseRowId so BlockSuite's editor opens the doc and
      // scrolls / highlights the kanban row that owns the deadline.
      workbench.openDoc(
        { docId: entry.docId, databaseRowId: entry.rowId },
        { at: 'active' }
      );
    },
    [workbench]
  );

  const handleMarkDone = useCallback(
    (entry: DeadlineEntry, done: boolean) => {
      deadlineIndex.markDone(entry.id, done);
    },
    [deadlineIndex]
  );

  const handleSnooze = useCallback(
    (entry: DeadlineEntry, days: number) => {
      deadlineIndex.snoozeByDays(entry.id, days);
    },
    [deadlineIndex]
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
  variant: 'overdue' | 'active' | 'done';
  onOpen: (entry: DeadlineEntry) => void;
  onMarkDone: (entry: DeadlineEntry, done: boolean) => void;
  onSnooze: (entry: DeadlineEntry, days: number) => void;
}

const DeadlineSection = ({
  title,
  entries,
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
  variant: 'overdue' | 'active' | 'done';
  onOpen: (entry: DeadlineEntry) => void;
  onMarkDone: (entry: DeadlineEntry, done: boolean) => void;
  onSnooze: (entry: DeadlineEntry, days: number) => void;
}

const DeadlineRow = ({
  entry,
  variant,
  onOpen,
  onMarkDone,
  onSnooze,
}: DeadlineRowProps) => {
  const effective = DeadlineIndexService.effectiveDeadline(entry);
  const isSnoozed = entry.snoozedUntil != null && effective !== entry.deadline;
  const dateLabel = `${new Date(effective).toLocaleDateString()}${
    isSnoozed ? ' (snoozed)' : ''
  }`;

  // Stop propagation so action buttons don't also open the doc.
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
