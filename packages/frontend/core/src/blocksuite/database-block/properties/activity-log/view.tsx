import { Popover, uniReactRoot } from '@affine/component';
import {
  type ActivityLogDocContext,
  parseValue,
  useActivityLogPanel,
} from '@affine/core/components/workspace-property-types/activity-log-shared';
import {
  type Cell,
  type CellRenderProps,
  createIcon,
  type DataViewCellLifeCycle,
  EditorHostKey,
} from '@blocksuite/affine/blocks/database';
import { CommentIcon } from '@blocksuite/icons/rc';
import { computed, type ReadonlySignal } from '@preact/signals-core';
import {
  forwardRef,
  type ForwardRefRenderFunction,
  type ReactNode,
  useImperativeHandle,
  useMemo,
} from 'react';

import { useSignalValue } from '../../../../modules/doc-info/utils';
import { activityLogPropertyModelConfig } from './define';
import * as styles from './style.css';

class ActivityLogManager {
  private readonly cell: Cell<string, string, {}>;
  readonly selectCurrentCell: (editing: boolean) => void;
  readonly isEditing: ReadonlySignal<boolean>;
  readonly docContext: ActivityLogDocContext;

  value = computed(() => this.cell.value$.value ?? '');

  get readonly() {
    return this.cell.property.readonly$;
  }

  constructor(props: CellRenderProps<{}, string, string>) {
    this.cell = props.cell;
    this.selectCurrentCell = props.selectCurrentCell;
    this.isEditing = props.isEditing$;
    const host = this.cell.view.serviceGet(EditorHostKey);
    const store = host?.std.store;
    const docId = store?.id ?? '';
    const title =
      (docId && store?.workspace.meta.getDocMeta(docId)?.title) || 'Untitled';
    // BlockSuite database/kanban blocks only render in page-mode docs.
    this.docContext = {
      id: docId,
      title,
      mode: 'page' as ActivityLogDocContext['mode'],
      // MOJO: include the kanban row id so mention notifications
      // carry the block reference and the deadlines auto-open hook
      // can pop the row's detail panel after navigation.
      rowId: this.cell.rowId,
    };
  }

  setValue = (next: string): void => {
    this.cell.valueSet(next);
  };
}

const ActivityLogCellComponent: ForwardRefRenderFunction<
  DataViewCellLifeCycle,
  CellRenderProps<{}, string, string>
> = (props, ref): ReactNode => {
  const manager = useMemo(
    () => new ActivityLogManager(props), // eslint-disable-line react-hooks/preserve-manual-memoization
    [] // oxlint-disable-line react/exhaustive-deps
  );

  useImperativeHandle(
    ref,
    () => ({
      beforeEnterEditMode: () => true,
      beforeExitEditingMode: () => {},
      afterEnterEditingMode: () => {},
      focusCell: () => true,
      blurCell: () => true,
      forceUpdate: () => {},
    }),
    []
  );

  const value = useSignalValue(manager.value);
  const isEditing = useSignalValue(manager.isEditing);
  const readonlyVal = !!useSignalValue(manager.readonly);

  const { entryCount, lastEntry, popoverBody } = useActivityLogPanel(
    value,
    manager.setValue,
    readonlyVal,
    manager.docContext
  );

  const lastLabel = lastEntry ? `${entryCount}` : '—';
  const snippet = lastEntry
    ? `${lastEntry.authorName}: ${lastEntry.text.slice(0, 32)}${
        lastEntry.text.length > 32 ? '…' : ''
      }`
    : 'No entries';

  return (
    <div className={styles.cellRoot}>
      <Popover
        open={isEditing}
        onOpenChange={(open: boolean) => manager.selectCurrentCell(open)}
        contentOptions={{
          className: styles.popoverContent,
          align: 'start',
          sideOffset: 4,
          // MOJO: keep the popover off the viewport edge so Radix
          // shrinks --radix-popper-available-height for us when the
          // cell sits near the bottom of the screen.
          collisionPadding: 12,
        }}
        content={<div className={styles.popoverInner}>{popoverBody}</div>}
      >
        <div className={styles.cellPreview}>
          <CommentIcon className={styles.cellIcon} />
          <span className={styles.cellCount}>{lastLabel}</span>
          <span className={styles.cellSnippet}>{snippet}</span>
        </div>
      </Popover>
    </div>
  );
};

const ActivityLogCell = forwardRef(ActivityLogCellComponent);

export const activityLogPropertyConfig =
  activityLogPropertyModelConfig.createPropertyMeta({
    icon: createIcon('CommentIcon'),
    cellRenderer: {
      view: uniReactRoot.createUniComponent(ActivityLogCell),
    },
  });

// Re-export for value-based group/sort wiring if needed later.
export const activityLogParse = parseValue;
