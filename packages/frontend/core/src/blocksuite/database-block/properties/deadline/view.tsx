import { uniReactRoot } from '@affine/component';
import {
  type Cell,
  type CellRenderProps,
  createIcon,
  type DataViewCellLifeCycle,
  EditorHostKey,
} from '@blocksuite/affine/blocks/database';
import { computed, type ReadonlySignal } from '@preact/signals-core';
import {
  type ChangeEvent,
  forwardRef,
  type ForwardRefRenderFunction,
  type ReactNode,
  useCallback,
  useImperativeHandle,
  useMemo,
} from 'react';

import { useSignalValue } from '../../../../modules/doc-info/utils';
import { deadlinePropertyModelConfig } from './define';
import * as styles from './style.css';

class DeadlineManager {
  readonly cell: Cell<number | null, number | null, {}>;
  readonly selectCurrentCell: (editing: boolean) => void;
  readonly isEditing: ReadonlySignal<boolean>;
  readonly createdBy: string | undefined;

  value = computed(() => this.cell.value$.value ?? null);

  get readonly() {
    return this.cell.property.readonly$;
  }

  constructor(props: CellRenderProps<{}, number | null, number | null>) {
    this.cell = props.cell;
    this.selectCurrentCell = props.selectCurrentCell;
    this.isEditing = props.isEditing$;
    const host = this.cell.view.serviceGet(EditorHostKey);
    const model = host?.std.store.getBlock(this.cell.rowId)?.model as
      | { props?: { 'meta:createdBy'?: string } }
      | undefined;
    this.createdBy = model?.props?.['meta:createdBy'];
  }

  setValue = (next: number | null): void => {
    this.cell.valueSet(next);
  };
}

const DeadlineCellComponent: ForwardRefRenderFunction<
  DataViewCellLifeCycle,
  CellRenderProps<{}, number | null, number | null>
> = (props, ref): ReactNode => {
  const manager = useMemo(
    () => new DeadlineManager(props), // eslint-disable-line react-hooks/preserve-manual-memoization
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

  // MOJO: only the row's creator (or workspace owner/admin) can change a
  // deadline. Everyone else sees the date in read-only mode.
  const auth = (
    globalThis as unknown as {
      __mojoAuthContext?: { userId: string | null; isOwnerOrAdmin: boolean };
    }
  ).__mojoAuthContext;
  const canEdit =
    !auth ||
    auth.isOwnerOrAdmin ||
    (!!manager.createdBy && manager.createdBy === auth.userId);

  const formatted = useMemo(() => {
    if (value == null) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString();
  }, [value]);

  const inputValue = useMemo(() => {
    if (value == null) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }, [value]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      if (!raw) {
        manager.setValue(null);
        return;
      }
      const ts = Date.parse(raw);
      manager.setValue(Number.isNaN(ts) ? null : ts);
    },
    [manager]
  );

  return (
    <div className={styles.cellRoot}>
      {canEdit ? (
        <input
          type="date"
          className={styles.dateInput}
          value={inputValue}
          onChange={handleChange}
        />
      ) : (
        <div
          className={styles.dateReadonly}
          title="Only the card creator can change this"
        >
          {formatted || '—'}
        </div>
      )}
    </div>
  );
};

const DeadlineCell = forwardRef(DeadlineCellComponent);

export const deadlinePropertyConfig =
  deadlinePropertyModelConfig.createPropertyMeta({
    icon: createIcon('DateTimeIcon'),
    cellRenderer: {
      view: uniReactRoot.createUniComponent(DeadlineCell),
    },
  });
