import type {
  DatabaseAllEvents,
  EventTraceFn,
} from '@blocksuite/affine-shared/services';
import type { DisposableMember } from '@blocksuite/global/disposable';
import { IS_MOBILE } from '@blocksuite/global/env';
import { BlockSuiteError } from '@blocksuite/global/exceptions';
import { SignalWatcher, WithDisposable } from '@blocksuite/global/lit';
import {
  type Clipboard,
  type EventName,
  ShadowlessElement,
  type UIEventHandler,
} from '@blocksuite/std';
import { computed, type ReadonlySignal, signal } from '@preact/signals-core';
import { css, unsafeCSS } from 'lit';
import { property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ref } from 'lit/directives/ref.js';
import { html } from 'lit/static-html.js';

import { dataViewCommonStyle } from './common/css-variable.js';
import type { DataSource } from './data-source/index.js';
import type { DataViewSelection } from './types.js';
import { renderUniLit } from './utils/uni-component/index.js';
import type { DataViewUILogicBase } from './view/data-view-base.js';
import type { SingleView } from './view-manager/single-view.js';
import type { DataViewWidget } from './widget/index.js';

export type DataViewRendererConfig = {
  clipboard: Clipboard;
  onDrag?: (evt: MouseEvent, id: string) => () => void;
  notification: {
    toast: (message: string) => void;
  };
  virtualPadding$: ReadonlySignal<number>;
  headerWidget: DataViewWidget | undefined;
  handleEvent: (name: EventName, handler: UIEventHandler) => DisposableMember;
  bindHotkey: (hotkeys: Record<string, UIEventHandler>) => DisposableMember;
  dataSource: DataSource;
  selection$: ReadonlySignal<DataViewSelection | undefined>;
  setSelection: (selection: DataViewSelection | undefined) => void;
  eventTrace: EventTraceFn<DatabaseAllEvents>;
  detailPanelConfig: {
    openDetailPanel: (
      target: HTMLElement,
      data: {
        view: SingleView;
        rowId: string;
      }
    ) => Promise<void>;
  };
};

export class DataViewRootUILogic {
  private get dataSource() {
    return this.config.dataSource;
  }
  private get viewManager() {
    return this.dataSource.viewManager;
  }
  private createDataViewUILogic(viewId: string): DataViewUILogicBase {
    const view = this.viewManager.viewGet(viewId);
    if (!view) {
      throw new BlockSuiteError(
        BlockSuiteError.ErrorCode.DatabaseBlockError,
        `View ${viewId} not found`
      );
    }

    const pcLogic = view.meta.renderer.pcLogic;
    const mobileLogic = view.meta.renderer.mobileLogic;
    const logic = (IS_MOBILE ? mobileLogic : pcLogic) ?? pcLogic;

    return new (logic(view))(this, view);
  }
  private readonly _viewsCache = new Map<
    string,
    { mode: string; logic: DataViewUILogicBase }
  >();

  private readonly views$ = computed(() => {
    const viewDataList = this.dataSource.viewDataList$.value;
    const validIds = new Set(viewDataList.map(viewData => viewData.id));

    for (const cachedId of this._viewsCache.keys()) {
      if (!validIds.has(cachedId)) {
        this._viewsCache.delete(cachedId);
      }
    }

    return viewDataList.map(viewData => {
      const cached = this._viewsCache.get(viewData.id);
      if (cached && cached.mode === viewData.mode) {
        return cached.logic;
      }
      const logic = this.createDataViewUILogic(viewData.id);
      this._viewsCache.set(viewData.id, {
        mode: viewData.mode,
        logic,
      });
      return logic;
    });
  });

  private readonly viewsMap$ = computed(() => {
    return Object.fromEntries(
      this.views$.value.map(logic => [logic.view.id, logic])
    );
  });
  private readonly _uiRef = signal<DataViewRootUI>();

  get selection$() {
    return this.config.selection$;
  }

  setSelection(selection?: DataViewSelection) {
    this.config.setSelection(selection);
  }

  constructor(public readonly config: DataViewRendererConfig) {}

  get dataViewRenderer() {
    return this._uiRef.value;
  }

  readonly currentViewId$ = computed(() => {
    return this.dataSource.viewManager.currentViewId$.value;
  });

  readonly currentView$ = computed(() => {
    const currentViewId = this.currentViewId$.value;
    if (!currentViewId) {
      return;
    }
    return this.viewsMap$.value[currentViewId];
  });

  focusFirstCell = () => {
    this.currentView$.value?.focusFirstCell();
  };

  openDetailPanel = (ops: {
    view: SingleView;
    rowId: string;
    onClose?: () => void;
  }) => {
    const openDetailPanel = this.config.detailPanelConfig.openDetailPanel;
    const target = this.dataViewRenderer;
    if (openDetailPanel && target) {
      openDetailPanel(target, {
        view: ops.view,
        rowId: ops.rowId,
      })
        .catch(console.error)
        .finally(ops.onClose);
    }
  };

  setupViewChangeListener() {
    let preId: string | undefined = undefined;
    return this.currentViewId$.subscribe(current => {
      if (current !== preId) {
        this.config.setSelection(undefined);
      }
      preId = current;
    });
  }

  render() {
    return html` <affine-data-view-renderer
      ${ref(this._uiRef)}
      .logic="${this}"
    ></affine-data-view-renderer>`;
  }
}

export class DataViewRootUI extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  static override styles = css`
    ${unsafeCSS(dataViewCommonStyle('affine-data-view-renderer'))}
    affine-data-view-renderer {
      background-color: var(--affine-background-primary-color);
      display: contents;
    }
  `;

  @property({ attribute: false })
  accessor logic!: DataViewRootUILogic;

  @state()
  accessor currentView: string | undefined = undefined;

  focusFirstCell = () => {
    this.logic.focusFirstCell();
  };

  openDetailPanel = (ops: {
    view: SingleView;
    rowId: string;
    onClose?: () => void;
  }) => {
    this.logic.openDetailPanel(ops);
  };

  override connectedCallback() {
    super.connectedCallback();
    this.disposables.add(this.logic.setupViewChangeListener());
    this._mojoMaybeOpenPendingCard();
    document.addEventListener(
      'mojo-open-kanban-card',
      this._mojoOnOpenCardEvent as EventListener
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(
      'mojo-open-kanban-card',
      this._mojoOnOpenCardEvent as EventListener
    );
  }

  // MOJO: when /deadlines navigates here it (a) parks a global the
  // freshly-mounted data-view checks, AND (b) dispatches an event that
  // already-mounted data-views catch. Either path looks up the row in
  // the current view's data source and pops the detail panel so the
  // user lands on the card body instead of an unfamiliar database
  // scroll. Mounted at the data-view-renderer level so it works for
  // every view variant (kanban / table / list / …).
  private readonly _mojoOnOpenCardEvent = (
    event: CustomEvent<{ rowId?: string }>
  ) => {
    const rowId = event.detail?.rowId;
    if (!rowId) return;
    const view = this.logic.currentView$.value;
    if (!view) return;
    if (!view.dataSource.rows$.value.includes(rowId)) return;
    requestAnimationFrame(() => {
      mojoOpenDetailWithFlag(() => this.openDetailPanel({ view, rowId }));
    });
  };

  private _mojoMaybeOpenPendingCard() {
    const slot = globalThis as unknown as {
      __mojoOpenKanbanCard?: { rowId?: string };
    };
    const pending = slot.__mojoOpenKanbanCard;
    if (!pending?.rowId) return;
    const targetRowId = pending.rowId;

    let opened = false;
    const tryOpen = () => {
      if (opened) return true;
      const view = this.logic.currentView$.value;
      if (!view) return false;
      if (!view.dataSource.rows$.value.includes(targetRowId)) return false;
      if (slot.__mojoOpenKanbanCard?.rowId !== targetRowId) {
        opened = true;
        return true;
      }
      delete slot.__mojoOpenKanbanCard;
      opened = true;
      requestAnimationFrame(() => {
        mojoOpenDetailWithFlag(() =>
          this.openDetailPanel({ view, rowId: targetRowId })
        );
      });
      return true;
    };

    if (tryOpen()) return;
    // Subscribe to currentView$ so we retry once the active view is
    // wired up. For each view, also subscribe to its rows$ in case
    // the data source hasn't hydrated yet.
    const viewSub = this.logic.currentView$.subscribe(view => {
      if (!view) return;
      if (tryOpen()) {
        viewSub.unsubscribe();
        return;
      }
      const rowSub = view.dataSource.rows$.subscribe(() => {
        if (tryOpen()) {
          rowSub.unsubscribe();
          viewSub.unsubscribe();
        }
      });
      setTimeout(() => rowSub.unsubscribe(), 8000);
    });
    setTimeout(() => viewSub.unsubscribe(), 8000);
  }

  override render() {
    const containerClass = classMap({
      'toolbar-hover-container': true,
      'data-view-root': true,
      'prevent-reference-popup': true,
    });
    const currentView = this.logic.currentView$.value;
    if (!currentView) {
      return;
    }
    return html`
      <div style="display: contents" class="${containerClass}">
        ${renderUniLit(currentView.renderer, {
          logic: currentView,
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-data-view-renderer': DataViewRootUI;
  }
}

// MOJO: when the user lands on a card via /deadlines, we want the
// row's own detail panel even if the row title happens to be a
// linked-doc reference. Flip the global before invoking
// openDetailPanel and clear it on the next microtask so the normal
// "click a kanban card" behaviour (which DOES prefer linked docs)
// stays untouched.
function mojoOpenDetailWithFlag(invoke: () => void) {
  const slot = globalThis as { __mojoForceDetailPanel?: boolean };
  const previous = slot.__mojoForceDetailPanel;
  slot.__mojoForceDetailPanel = true;
  try {
    invoke();
  } catch (e) {
    console.warn('[mojo deadline] auto-open card failed', e);
  } finally {
    queueMicrotask(() => {
      slot.__mojoForceDetailPanel = previous;
    });
  }
}
