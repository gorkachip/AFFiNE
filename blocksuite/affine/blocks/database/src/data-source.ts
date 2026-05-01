import type {
  ColumnDataType,
  ColumnUpdater,
  DatabaseBlockModel,
  ParagraphBlockModel,
} from '@blocksuite/affine-model';
import { getSelectedModelsCommand } from '@blocksuite/affine-shared/commands';
import { FeatureFlagService } from '@blocksuite/affine-shared/services';
import {
  insertPositionToIndex,
  type InsertToPosition,
} from '@blocksuite/affine-shared/utils';
import {
  type DatabaseFlags,
  DataSourceBase,
  type DataViewDataType,
  type PropertyMetaConfig,
  type TypeInstance,
  type ViewManager,
  ViewManagerBase,
  type ViewMeta,
} from '@blocksuite/data-view';
import { propertyPresets } from '@blocksuite/data-view/property-presets';
import { IS_MOBILE } from '@blocksuite/global/env';
import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';
import type { EditorHost } from '@blocksuite/std';
import { type BlockModel } from '@blocksuite/store';
import { computed, type ReadonlySignal, signal } from '@preact/signals-core';

import { getIcon } from './block-icons.js';
import {
  databaseBlockProperties,
  databasePropertyConverts,
} from './properties/index.js';
import {
  addProperty,
  copyCellsByProperty,
  deleteRows,
  deleteView,
  duplicateView,
  getCell,
  getProperty,
  moveViewTo,
  updateCell,
  updateCells,
  updateProperty,
  updateView,
} from './utils/block-utils.js';
import {
  databaseBlockViewConverts,
  databaseBlockViewMap,
  databaseBlockViews,
} from './views/index.js';

type SpacialProperty = {
  valueSet: (rowId: string, propertyId: string, value: unknown) => void;
  valueGet: (rowId: string, propertyId: string) => unknown;
};

// MOJO: read by every database mutation to enforce "creator or admin only"
// on column delete and to attribute changes back to the acting user. Set by
// MojoAuthBridge in the React host; falls back to a no-op when absent (e.g.
// running outside the AFFiNE shell during tests).
type MojoAuthContext = {
  userId: string | null;
  userName?: string | null;
  isOwnerOrAdmin: boolean;
};
function getMojoAuth(): MojoAuthContext | undefined {
  return (globalThis as unknown as { __mojoAuthContext?: MojoAuthContext })
    .__mojoAuthContext;
}

// MOJO: notify the React shell so it can pop a toast. Used alongside a
// thrown Error inside the gate so the user gets an explanation even if
// the upstream caller swallows the exception (most BlockSuite handlers
// just log the throw and continue silently).
function notifyDeleteBlocked(message: string): void {
  if (typeof document === 'undefined' || !document.dispatchEvent) return;
  document.dispatchEvent(
    new CustomEvent('mojo-delete-blocked', { detail: { message } })
  );
}

// MOJO: read the meta:trashed flag through the prop's reactive signal
// when available so any computed that depends on it re-runs on changes.
function isRowTrashed(model: ParagraphBlockModel): boolean {
  const trashedSignal = (
    model.props as unknown as {
      'meta:trashed$'?: { value: unknown };
    }
  )['meta:trashed$'];
  if (trashedSignal) return !!trashedSignal.value;
  return !!model.props['meta:trashed'];
}

export class DatabaseBlockDataSource extends DataSourceBase {
  override get parentProvider() {
    return this._model.store.provider;
  }

  spacialProperties: Record<string, SpacialProperty> = {
    'created-time': {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId) as ParagraphBlockModel;
        if (!model) {
          return null;
        }
        return model.props['meta:createdAt'];
      },
    },
    'created-by': {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId) as
          | ParagraphBlockModel
          | undefined;
        return model ? model.props['meta:createdBy'] : null;
      },
    },
    'updated-by': {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId) as
          | ParagraphBlockModel
          | undefined;
        return model
          ? (model.props['meta:updatedBy'] ?? model.props['meta:createdBy'])
          : null;
      },
    },
    'updated-time': {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId) as ParagraphBlockModel;
        if (!model) return null;
        return model.props['meta:updatedAt'] ?? model.props['meta:createdAt'];
      },
    },
    type: {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId);
        if (!model) {
          return;
        }
        return getIcon(model);
      },
    },
    title: {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId);
        if (!model) {
          return;
        }
        return model.text;
      },
    },
  };

  isSpacialProperty(propertyType: string): boolean {
    return this.spacialProperties[propertyType] !== undefined;
  }

  spacialValueGet(
    rowId: string,
    propertyId: string,
    propertyType: string
  ): unknown {
    return this.spacialProperties[propertyType]?.valueGet(rowId, propertyId);
  }

  static externalProperties = signal<PropertyMetaConfig[]>([]);
  static propertiesList = computed(() => {
    return [
      ...Object.values(databaseBlockProperties),
      ...this.externalProperties.value,
    ];
  });
  static propertiesMap = computed(() => {
    return Object.fromEntries(
      this.propertiesList.value.map(v => [v.type, v as PropertyMetaConfig])
    );
  });

  private _batch = 0;

  private readonly _model: DatabaseBlockModel;

  override featureFlags$: ReadonlySignal<DatabaseFlags> = computed(() => {
    const featureFlagService = this.doc.get(FeatureFlagService);
    const enableTableVirtualScroll = featureFlagService.getFlag(
      'enable_table_virtual_scroll'
    );
    return {
      enable_table_virtual_scroll: enableTableVirtualScroll ?? false,
    };
  });

  properties$: ReadonlySignal<string[]> = computed(() => {
    const fixedPropertiesSet = new Set(this.fixedProperties$.value);
    const properties: string[] = [];
    this._model.props.columns$.value.forEach(column => {
      if (fixedPropertiesSet.has(column.type)) {
        fixedPropertiesSet.delete(column.type);
      }
      properties.push(column.id);
    });

    const result = [...fixedPropertiesSet, ...properties];
    return result;
  });

  readonly$: ReadonlySignal<boolean> = computed(() => {
    return (
      this._model.store.readonly ||
      (IS_MOBILE &&
        !this._model.store.provider
          .get(FeatureFlagService)
          .getFlag('enable_mobile_database_editing'))
    );
  });

  rows$: ReadonlySignal<string[]> = computed(() => {
    // Read each child's meta:trashed signal so this computed re-runs when a
    // row gets soft-trashed or restored. Reading model.children alone only
    // tracks add/remove of children, not prop mutations on them.
    return this._model.children
      .filter(v => !isRowTrashed(v as ParagraphBlockModel))
      .map(v => v.id);
  });

  // MOJO: trashed rows surfaced to the per-kanban Trash UI for admins.
  trashedRows$: ReadonlySignal<string[]> = computed(() => {
    return this._model.children
      .filter(v => isRowTrashed(v as ParagraphBlockModel))
      .map(v => v.id);
  });

  viewConverts = databaseBlockViewConverts;

  viewDataList$: ReadonlySignal<DataViewDataType[]> = computed(() => {
    return this._model.props.views$.value as DataViewDataType[];
  });

  override viewManager: ViewManager = new ViewManagerBase(this);

  viewMetas = databaseBlockViews;

  get doc() {
    return this._model.store;
  }

  allPropertyMetas$ = computed<PropertyMetaConfig<any, any, any, any>[]>(() => {
    return DatabaseBlockDataSource.propertiesList.value;
  });

  propertyMetas$ = computed<PropertyMetaConfig[]>(() => {
    return this.allPropertyMetas$.value.filter(
      v => !v.config.fixed && !v.config.hide
    );
  });

  constructor(
    model: DatabaseBlockModel,
    init?: (dataSource: DatabaseBlockDataSource) => void
  ) {
    super();
    this._model = model; // ensure invariants first
    init?.(this); // then allow external initialisation
    // MOJO: backfill the workspace deadlines index from existing rows
    // when the data-source is created. Covers cards that had a deadline
    // set before DeadlineIndexService was alive (initial deploy of the
    // index, or first time the user opens a kanban after a fresh load).
    queueMicrotask(() => this._bootstrapDeadlineIndex());
    // MOJO: re-sync deadline index entries when a row's title (or any
    // other prop) changes after the initial sync, so the cached title
    // shown in /deadlines and the journal calendar stays current.
    this._model.store.slots.blockUpdated.subscribe(payload => {
      if (payload.type !== 'update') return;
      const block = this._model.store.getBlock(payload.id);
      if (!block) return;
      let parent = block.model.parent;
      while (parent) {
        if (parent.id === this._model.id) {
          this._syncDeadlineIndex(payload.id);
          return;
        }
        parent = parent.parent;
      }
    });
  }

  private _bootstrapDeadlineIndex(): void {
    try {
      const cols = this._model.props.columns$.value;
      const hasDeadlineColumn = cols.some(c => c.type === 'deadline');

      console.log('[mojo deadline] bootstrap scan', {
        docId: this._model.store.id,
        columnTypes: cols.map(c => c.type),
        rowCount: this._model.children.length,
        hasDeadlineColumn,
      });
      if (!hasDeadlineColumn) return;
      for (const row of this._model.children) {
        this._syncDeadlineIndex(row.id);
      }
    } catch (e) {
      console.warn('[mojo] deadline bootstrap failed', e);
    }
  }

  private _runCapture() {
    if (this._batch) {
      return;
    }

    this._batch = requestAnimationFrame(() => {
      this.doc.captureSync();
      this._batch = 0;
    });
  }

  private getModelById(rowId: string): BlockModel | undefined {
    return this._model.children[this._model.childMap.value.get(rowId) ?? -1];
  }

  private newPropertyName(prefix = 'Column'): string {
    let i = 1;
    const hasSameName = (name: string) => {
      return this._model.props.columns$.value.some(
        column => column.name === name
      );
    };
    while (true) {
      let name = i === 1 ? prefix : `${prefix} ${i}`;
      if (!hasSameName(name)) {
        return name;
      }
      i++;
    }
  }

  cellValueChange(rowId: string, propertyId: string, value: unknown): void {
    this._runCapture();

    const type = this.propertyTypeGet(propertyId);
    if (type == null) {
      return;
    }
    const update = this.propertyMetaGet(type)?.config.rawValue.setValue;
    const old = this.cellValueGet(rowId, propertyId);
    const updateFn =
      update ??
      (({ setValue, newValue }) => {
        setValue(newValue);
      });
    updateFn({
      value: old,
      data: this.propertyDataGet(propertyId),
      dataSource: this,
      newValue: value,
      setValue: newValue => {
        if (this._model.props.columns$.value.some(v => v.id === propertyId)) {
          updateCell(this._model, rowId, {
            columnId: propertyId,
            value: newValue,
          });
        }
      },
    });
    // MOJO: cell mutations live on the parent database block, so the row
    // block's own meta:updatedBy never moves. Stamp it here so the
    // "Last Edited By" column reflects whoever just changed any cell
    // (status, member, comment, activity log entry, etc).
    this._touchRowAuthor(rowId);
    // MOJO: keep the workspace deadlines index in sync. Triggered when
    // either a deadline cell changed directly OR a member cell changed
    // on a row that already has a deadline (so member assignments flow
    // through to the calendar view).
    if (type === 'deadline' || type === 'member') {
      this._syncDeadlineIndex(rowId);
    }
    // MOJO: append an entry to the card activity log so the user can
    // see who touched what (status changes, member assignments, deadline
    // moves, etc). Skip our own internal MOJO Activity Log property to
    // avoid recursion noise.
    if (type !== 'activity-log') {
      this._logCardActivity(rowId, propertyId, type, value, old);
    }
  }

  private _logCardActivity(
    rowId: string,
    propertyId: string,
    columnType: string,
    newValue: unknown,
    oldValue?: unknown
  ): void {
    const bridge = (
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
    ).__mojoCardActivityLog;
    if (!bridge) return;
    const auth = getMojoAuth();
    const column = this._model.props.columns$.value.find(
      c => c.id === propertyId
    );
    const columnName = column?.name ?? columnType;
    // MOJO: resolve raw IDs to human-readable labels for select/tag
    // columns so the modal doesn't end up rendering option UUIDs.
    const labelValue = (val: unknown): unknown => {
      if (val == null) return val;
      const data = column?.data as
        | { options?: Array<{ id: string; value?: string }> }
        | undefined;
      const opts = data?.options;
      if (!opts) return val;
      if (typeof val === 'string') {
        const opt = opts.find(o => o.id === val);
        return opt?.value ?? val;
      }
      if (Array.isArray(val)) {
        return val.map(v =>
          typeof v === 'string' ? (opts.find(o => o.id === v)?.value ?? v) : v
        );
      }
      return val;
    };
    bridge.add({
      rowId,
      docId: this._model.store.id,
      actorId: auth?.userId ?? undefined,
      // MOJO: stamp the actor's display name on the activity entry so
      // the modal doesn't have to resolve it later (and won't render
      // blank if the user has since left the workspace).
      actorName: auth?.userName ?? undefined,
      action: `Changed ${columnName}`,
      details: {
        columnType,
        columnName,
        newValue: labelValue(newValue),
        oldValue: labelValue(oldValue),
      },
    });
  }

  private _syncDeadlineIndex(rowId: string): void {
    const bridge = (
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
    ).__mojoDeadlineIndex;
    if (!bridge) {
      console.warn('[mojo deadline] sync skipped — bridge not installed', {
        rowId,
      });
      return;
    }
    const docId = this._model.store.id;
    let deadline: number | null = null;
    const memberIds: string[] = [];
    for (const column of this._model.props.columns$.value) {
      if (column.type === 'deadline') {
        const v = this.cellValueGet(rowId, column.id);
        if (typeof v === 'number') deadline = v;
      } else if (column.type === 'member') {
        const v = this.cellValueGet(rowId, column.id);
        if (Array.isArray(v)) {
          for (const id of v) {
            if (typeof id === 'string') memberIds.push(id);
          }
        }
      }
    }
    if (deadline == null) {
      bridge.remove(docId, rowId);
      return;
    }
    const block = this.doc.getBlock(rowId);
    const model = block?.model as
      | { text?: { toString(): string }; props?: { 'meta:createdBy'?: string } }
      | undefined;
    const title = model?.text?.toString().trim() || '';
    const createdBy = model?.props?.['meta:createdBy'];
    bridge.upsert({ docId, rowId, deadline, createdBy, memberIds, title });
  }

  private _touchRowAuthor(rowId: string): void {
    const auth = getMojoAuth();
    if (!auth?.userId) return;
    const block = this.doc.getBlock(rowId);
    const model = block?.model as ParagraphBlockModel | undefined;
    if (!model) return;
    if (!model.keys.includes('meta:updatedBy')) return;
    this.doc.withoutTransact(() => {
      model.props['meta:updatedBy'] = auth.userId ?? undefined;
      model.props['meta:updatedAt'] = Date.now();
    });
  }

  cellValueGet(rowId: string, propertyId: string): unknown {
    if (this.isSpacialProperty(propertyId)) {
      return this.spacialValueGet(rowId, propertyId, propertyId);
    }
    const type = this.propertyTypeGet(propertyId);
    if (!type) {
      return;
    }
    if (this.isSpacialProperty(type)) {
      return this.spacialValueGet(rowId, propertyId, type);
    }
    const meta = this.propertyMetaGet(type);
    if (!meta) {
      return;
    }
    const rawValue =
      getCell(this._model, rowId, propertyId)?.value ??
      meta.config.rawValue.default();
    const schema = meta.config.rawValue.schema;
    const result = schema.safeParse(rawValue);
    if (result.success) {
      return result.data;
    }
    return;
  }

  propertyAdd(
    insertToPosition: InsertToPosition,
    ops?: {
      type?: string;
      name?: string;
    }
  ): string | undefined {
    this.doc.captureSync();
    const { type, name } = ops ?? {};
    const property = this.propertyMetaGet(
      type ?? propertyPresets.multiSelectPropertyConfig.type
    );
    if (!property) {
      return;
    }
    const created = property.create(this.newPropertyName(name));
    // MOJO: stamp the creator so we can gate column deletions later.
    const auth = getMojoAuth();
    if (auth?.userId) {
      created.createdBy = auth.userId;
    }
    const result = addProperty(this._model, insertToPosition, created);
    return result;
  }

  protected override getNormalPropertyAndIndex(propertyId: string):
    | {
        column: ColumnDataType<Record<string, unknown>>;
        index: number;
      }
    | undefined {
    const index = this._model.props.columns$.value.findIndex(
      v => v.id === propertyId
    );
    if (index >= 0) {
      const column = this._model.props.columns$.value[index];
      if (!column) {
        return;
      }
      return {
        column,
        index,
      };
    }
    return;
  }

  private getPropertyAndIndex(propertyId: string):
    | {
        column: ColumnDataType<Record<string, unknown>>;
        index: number;
      }
    | undefined {
    const result = this.getNormalPropertyAndIndex(propertyId);
    if (result) {
      return result;
    }
    if (this.isFixedProperty(propertyId)) {
      const meta = this.propertyMetaGet(propertyId);
      if (!meta) {
        return;
      }
      const defaultData = meta.config.fixed?.defaultData ?? {};
      return {
        column: {
          data: defaultData,
          id: propertyId,
          type: propertyId,
          name: meta.config.name,
        },
        index: -1,
      };
    }
    return undefined;
  }

  private updateProperty(id: string, updater: ColumnUpdater) {
    const result = this.getPropertyAndIndex(id);
    if (!result) {
      return;
    }
    const { column: prevColumn, index } = result;
    this._model.store.transact(() => {
      if (index >= 0) {
        const result = updater(prevColumn);
        this._model.props.columns[index] = { ...prevColumn, ...result };
      } else {
        const result = updater(prevColumn);
        this._model.props.columns = [
          ...this._model.props.columns,
          { ...prevColumn, ...result },
        ];
      }
    });
    return id;
  }

  propertyDataGet(propertyId: string): Record<string, unknown> {
    const result = this.getPropertyAndIndex(propertyId);
    if (!result) {
      return {};
    }
    return result.column.data;
  }

  propertyDataSet(propertyId: string, data: Record<string, unknown>): void {
    this._runCapture();
    this.updateProperty(propertyId, () => ({ data }));
  }

  propertyDataTypeGet(propertyId: string): TypeInstance | undefined {
    const result = this.getPropertyAndIndex(propertyId);
    if (!result) {
      return;
    }
    const { column } = result;
    const meta = this.propertyMetaGet(column.type);
    if (!meta) {
      return;
    }
    return meta.config?.jsonValue.type({
      data: column.data,
      dataSource: this,
    });
  }

  propertyDelete(id: string): void {
    if (this.isFixedProperty(id)) {
      return;
    }
    this.doc.captureSync();
    const index = this._model.props.columns.findIndex(v => v.id === id);
    if (index < 0) return;

    // MOJO: only the column's creator (or workspace owner/admin) can drop it.
    const auth = getMojoAuth();
    if (auth && !auth.isOwnerOrAdmin) {
      const column = this._model.props.columns[index];
      const createdBy = column?.createdBy;
      if (createdBy && createdBy !== auth.userId) {
        const msg =
          'Only the column creator or a workspace admin can delete this property.';
        notifyDeleteBlocked(msg);
        throw new Error(msg);
      }
    }

    this.doc.transact(() => {
      this._model.props.columns = this._model.props.columns.filter(
        (_, i) => i !== index
      );
    });
  }

  propertyDuplicate(propertyId: string): string | undefined {
    if (this.isFixedProperty(propertyId)) {
      return;
    }
    this.doc.captureSync();
    const currentSchema = getProperty(this._model, propertyId);
    if (!currentSchema) {
      return;
    }
    const { id: copyId, ...nonIdProps } = currentSchema;
    const names = new Set(this._model.props.columns$.value.map(v => v.name));
    let index = 1;
    while (names.has(`${nonIdProps.name}(${index})`)) {
      index++;
    }
    const schema = { ...nonIdProps, name: `${nonIdProps.name}(${index})` };
    const id = addProperty(
      this._model,
      {
        before: false,
        id: propertyId,
      },
      schema
    );
    copyCellsByProperty(this._model, copyId, id);
    return id;
  }

  propertyMetaGet(type: string): PropertyMetaConfig | undefined {
    return DatabaseBlockDataSource.propertiesMap.value[type];
  }

  propertyNameGet(propertyId: string): string {
    if (propertyId === 'type') {
      return 'Block Type';
    }
    const result = this.getPropertyAndIndex(propertyId);
    if (!result) {
      return '';
    }
    return result.column.name;
  }

  propertyNameSet(propertyId: string, name: string): void {
    this.doc.captureSync();
    this.updateProperty(propertyId, () => ({ name }));
  }

  override propertyReadonlyGet(propertyId: string): boolean {
    if (propertyId === 'type') return true;
    return false;
  }

  propertyTypeGet(propertyId: string): string | undefined {
    if (propertyId === 'type') {
      return 'image';
    }
    const result = this.getPropertyAndIndex(propertyId);
    if (!result) {
      return;
    }
    return result.column.type;
  }

  propertyTypeSet(propertyId: string, toType: string): void {
    if (this.isFixedProperty(propertyId)) {
      return;
    }
    const meta = this.propertyMetaGet(toType);
    if (!meta) {
      return;
    }
    const currentType = this.propertyTypeGet(propertyId);
    const currentData = this.propertyDataGet(propertyId);
    const rows = this.rows$.value;
    const currentCells = rows.map(rowId =>
      this.cellValueGet(rowId, propertyId)
    );
    const convertFunction = databasePropertyConverts.find(
      v => v.from === currentType && v.to === toType
    )?.convert;
    const result = convertFunction?.(
      currentData as any,

      currentCells as any
    ) ?? {
      property: meta.config.propertyData.default(),
      cells: currentCells.map(() => undefined),
    };
    this.doc.captureSync();
    updateProperty(this._model, propertyId, () => ({
      type: toType,
      data: result.property,
    }));
    const cells: Record<string, unknown> = {};
    currentCells.forEach((value, i) => {
      if (value != null || result.cells[i] != null) {
        const rowId = rows[i];
        if (rowId) {
          cells[rowId] = result.cells[i];
        }
      }
    });
    updateCells(this._model, propertyId, cells);
  }

  rowAdd(insertPosition: InsertToPosition | number): string {
    this.doc.captureSync();
    const index =
      typeof insertPosition === 'number'
        ? insertPosition
        : insertPositionToIndex(insertPosition, this._model.children);
    return this.doc.addBlock('affine:paragraph', {}, this._model.id, index);
  }

  rowDelete(ids: string[]): void {
    // MOJO: rows go to a per-kanban soft-delete bin instead of being
    // physically removed. Hard-delete only happens via rowPermaDelete from
    // the admin Trash UI. Collaborators can only soft-delete rows they
    // created (or any row, if they're a workspace admin).
    const auth = getMojoAuth();
    this.doc.captureSync();
    this.doc.transact(() => {
      for (const id of ids) {
        const block = this.doc.getBlock(id);
        const model = block?.model as ParagraphBlockModel | undefined;
        if (!model) continue;
        if (auth && !auth.isOwnerOrAdmin) {
          const createdBy = model.props['meta:createdBy'];
          if (createdBy && createdBy !== auth.userId) {
            const msg =
              'Only the card creator or a workspace admin can delete this card.';
            notifyDeleteBlocked(msg);
            throw new Error(msg);
          }
        }
        if (model.keys.includes('meta:trashed')) {
          model.props['meta:trashed'] = true;
          model.props['meta:trashedAt'] = Date.now();
        } else {
          // Legacy block without the soft-trash field — fall back to the
          // original hard-delete so the action still has an effect.
          this.doc.deleteBlock(model);
        }
        // MOJO: drop from the workspace deadlines index while the row is
        // trashed. rowRestore re-syncs it.
        this._removeFromDeadlineIndex(id);
      }
    });
  }

  private _removeFromDeadlineIndex(rowId: string): void {
    const bridge = (
      globalThis as unknown as {
        __mojoDeadlineIndex?: {
          remove: (docId: string, rowId: string) => void;
        };
      }
    ).__mojoDeadlineIndex;
    bridge?.remove(this._model.store.id, rowId);
  }

  // MOJO: restore a previously trashed row. Allowed for the original
  // creator (so they can undo their own accidental deletes) and for
  // workspace owners/admins.
  rowRestore(ids: string[]): void {
    const auth = getMojoAuth();
    this.doc.captureSync();
    this.doc.transact(() => {
      for (const id of ids) {
        const block = this.doc.getBlock(id);
        const model = block?.model as ParagraphBlockModel | undefined;
        if (!model) continue;
        if (auth && !auth.isOwnerOrAdmin) {
          const createdBy = model.props['meta:createdBy'];
          if (createdBy && createdBy !== auth.userId) {
            const msg =
              'Only the card creator or a workspace admin can restore this card.';
            notifyDeleteBlocked(msg);
            throw new Error(msg);
          }
        }
        if (model.keys.includes('meta:trashed')) {
          model.props['meta:trashed'] = undefined;
          model.props['meta:trashedAt'] = undefined;
        }
        // MOJO: re-sync the deadline index so the card shows up in the
        // calendar again if it still has a deadline set.
        this._syncDeadlineIndex(id);
      }
    });
  }

  // MOJO: admin-only — permanently delete a trashed row. The hard-delete
  // is irreversible, so we keep this gated to workspace owners/admins
  // even if the caller created the row.
  rowPermaDelete(ids: string[]): void {
    const auth = getMojoAuth();
    if (auth && !auth.isOwnerOrAdmin) {
      const msg = 'Only a workspace admin can permanently delete a card.';
      notifyDeleteBlocked(msg);
      throw new Error(msg);
    }
    this.doc.captureSync();
    for (const id of ids) {
      const block = this.doc.getBlock(id);
      if (block) {
        this.doc.deleteBlock(block.model);
      }
      this._removeFromDeadlineIndex(id);
    }
    deleteRows(this._model, ids);
  }

  rowMove(rowId: string, position: InsertToPosition): void {
    const model = this.doc.getModelById(rowId);
    if (model) {
      const index = insertPositionToIndex(position, this._model.children);
      const target = this._model.children[index];
      if (target?.id === rowId) {
        return;
      }
      this.doc.moveBlocks([model], this._model, target);
    }
  }

  viewDataAdd(viewData: DataViewDataType): string {
    // MOJO: stamp the view's creator so collaborators can't drop views
    // built by others.
    const auth = getMojoAuth();
    const stamped: DataViewDataType =
      auth?.userId && !viewData.createdBy
        ? { ...viewData, createdBy: auth.userId }
        : viewData;
    this._model.store.captureSync();
    this._model.store.transact(() => {
      this._model.props.views = [...this._model.props.views, stamped];
    });
    return stamped.id;
  }

  viewDataDelete(viewId: string): void {
    // MOJO: gate by view creator unless caller is workspace owner/admin.
    const auth = getMojoAuth();
    if (auth && !auth.isOwnerOrAdmin) {
      const view = this._model.props.views$.value.find(v => v.id === viewId);
      const createdBy = view?.createdBy;
      if (createdBy && createdBy !== auth.userId) {
        const msg =
          'Only the view creator or a workspace admin can delete this view.';
        notifyDeleteBlocked(msg);
        throw new Error(msg);
      }
    }
    this._model.store.captureSync();
    deleteView(this._model, viewId);
  }

  viewDataDuplicate(id: string): string {
    return duplicateView(this._model, id);
  }

  viewDataGet(viewId: string): DataViewDataType | undefined {
    return this.viewDataList$.value.find(data => data.id === viewId)!;
  }

  viewDataMoveTo(id: string, position: InsertToPosition): void {
    moveViewTo(this._model, id, position);
  }

  viewDataUpdate<ViewData extends DataViewDataType>(
    id: string,
    updater: (data: ViewData) => Partial<ViewData>
  ): void {
    updateView(this._model, id, updater);
  }

  viewMetaGet(type: string): ViewMeta {
    const view = databaseBlockViewMap[type];
    if (!view) {
      throw new BlockSuiteError(
        ErrorCode.DatabaseBlockError,
        `Unknown view type: ${type}`
      );
    }
    return view;
  }

  viewMetaGetById(viewId: string): ViewMeta | undefined {
    const view = this.viewDataGet(viewId);
    if (!view) {
      return;
    }
    return this.viewMetaGet(view.mode);
  }
}

export const databaseViewInitTemplate = (
  datasource: DatabaseBlockDataSource,
  viewType: string
) => {
  Array.from({ length: 3 }).forEach(() => {
    datasource.rowAdd('end');
  });
  datasource.viewManager.viewAdd(viewType);
};
export const convertToDatabase = (host: EditorHost, viewType: string) => {
  const [_, ctx] = host.std.command.exec(getSelectedModelsCommand, {
    types: ['block', 'text'],
  });
  const { selectedModels } = ctx;
  const firstModel = selectedModels?.[0];
  if (!firstModel) return;

  host.store.captureSync();

  const parentModel = host.store.getParent(firstModel);
  if (!parentModel) {
    return;
  }

  const id = host.store.addBlock(
    'affine:database',
    {},
    parentModel,
    parentModel.children.indexOf(firstModel)
  );
  const databaseModel = host.store.getBlock(id)?.model as
    | DatabaseBlockModel
    | undefined;
  if (!databaseModel) {
    return;
  }
  const datasource = new DatabaseBlockDataSource(databaseModel);
  datasource.viewManager.viewAdd(viewType);
  host.store.moveBlocks(selectedModels, databaseModel);

  const selectionManager = host.selection;
  selectionManager.clear();
};
