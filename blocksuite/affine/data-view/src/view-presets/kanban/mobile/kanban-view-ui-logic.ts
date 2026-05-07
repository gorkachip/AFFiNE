import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/affine-components/context-menu';
import { unsafeCSSVarV2 } from '@blocksuite/affine-shared/theme';
import type { InsertToPosition } from '@blocksuite/affine-shared/utils';
import { AddCursorIcon } from '@blocksuite/icons/lit';
import { css } from '@emotion/css';
import { signal } from '@preact/signals-core';
import type { TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { html } from 'lit/static-html.js';

import {
  createUniComponentFromWebComponent,
  renderUniLit,
} from '../../../core/index.js';
import { sortable } from '../../../core/utils/wc-dnd/sort/sort-context.js';
import {
  DataViewUIBase,
  DataViewUILogicBase,
} from '../../../core/view/data-view-base.js';
import type { KanbanSingleView } from '../kanban-view-manager.js';
import type { KanbanViewSelectionWithType } from '../selection';
import { popCardMenu } from './menu.js';

const mobileKanbanViewWrapper = css({
  userSelect: 'none',
  display: 'flex',
  flexDirection: 'column',
});

const mobileKanbanGroups = css({
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  gap: '20px',
  paddingBottom: '4px',
  overflowX: 'scroll',
  overflowY: 'hidden',
});

const mobileAddGroup = css({
  height: '32px',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  padding: '4px',
  borderRadius: '4px',
  fontSize: '16px',
  color: `var(${unsafeCSSVarV2('icon/primary')})`,
});

export class MobileKanbanViewUILogic extends DataViewUILogicBase<
  KanbanSingleView,
  KanbanViewSelectionWithType
> {
  ui$ = signal<MobileKanbanViewUI | undefined>(undefined);

  private get readonly() {
    return this.view.readonly$.value;
  }

  clearSelection = () => {};

  addRow = (position: InsertToPosition) => {
    if (this.readonly) return;
    const id = this.view.rowAdd(position);
    this.ui$.value?.requestUpdate();
    return id;
  };

  focusFirstCell = () => {};

  showIndicator = (_evt: MouseEvent) => {
    return false;
  };

  hideIndicator = () => {};

  moveTo = () => {};

  get groupManager() {
    return this.view.groupTrait;
  }

  renderAddGroup = () => {
    if (this.readonly) {
      return;
    }
    const addGroup = this.groupManager.addGroup;
    if (!addGroup) {
      return;
    }
    const add = (e: MouseEvent) => {
      const ele = e.currentTarget as HTMLElement;
      popMenu(popupTargetFromElement(ele), {
        options: {
          items: [
            menu.input({
              onComplete: text => {
                const column = this.groupManager.property$.value;
                if (column) {
                  column.dataUpdate(() =>
                    addGroup({
                      text,
                      oldData: column.data$.value,
                      dataSource: this.view.manager.dataSource,
                    })
                  );
                }
              },
            }),
          ],
        },
      });
    };
    return html` <div class="${mobileAddGroup}" @click="${add}">
      ${AddCursorIcon()}
    </div>`;
  };

  renderer = createUniComponentFromWebComponent(MobileKanbanViewUI);
}

export class MobileKanbanViewUI extends DataViewUIBase<MobileKanbanViewUILogic> {
  override connectedCallback(): void {
    super.connectedCallback();
    this.logic.ui$.value = this;
    this.classList.add(mobileKanbanViewWrapper);
    this._mojoMaybeOpenPendingCard();
    document.addEventListener(
      'mojo-detail-card-menu',
      this._mojoOnDetailCardMenu as EventListener
    );
    document.addEventListener(
      'mojo-open-kanban-card',
      this._mojoOnOpenKanbanCardEvent as EventListener
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener(
      'mojo-detail-card-menu',
      this._mojoOnDetailCardMenu as EventListener
    );
    document.removeEventListener(
      'mojo-open-kanban-card',
      this._mojoOnOpenKanbanCardEvent as EventListener
    );
  }

  // MOJO: covers the case where the doc was already open before the
  // user clicked a deadline — the kanban doesn't remount so the
  // global-on-mount check never fires. Listening for the explicit
  // event always lets us pop the detail.
  private readonly _mojoOnOpenKanbanCardEvent = (
    event: CustomEvent<{ rowId?: string }>
  ) => {
    const rowId = event.detail?.rowId;
    if (!rowId) return;
    const view = this.logic.view;
    if (!view.dataSource.rows$.value.includes(rowId)) return;
    requestAnimationFrame(() => {
      try {
        this.logic.root.openDetailPanel({ view, rowId });
      } catch (e) {
        console.warn('[mojo deadline] auto-open card (event) failed', e);
      }
    });
  };

  // MOJO: same wiring as the PC kanban — the generic detail panel
  // emits this when its "•••" is tapped; we open the existing
  // mobile card menu so the expanded view has full parity with
  // the small kanban card.
  private readonly _mojoOnDetailCardMenu = (
    event: CustomEvent<{ rowId?: string; anchor?: HTMLElement }>
  ) => {
    const detail = event.detail;
    const rowId = detail?.rowId;
    const anchor = detail?.anchor;
    if (!rowId || !anchor) return;
    const view = this.logic.view;
    const rowIds = view.dataSource.rows$.value;
    if (!rowIds.includes(rowId)) return;
    const groupKey =
      view.groupTrait.groupsDataList$.value?.find(g =>
        g?.rows.some(r => r.rowId === rowId)
      )?.key ?? '';
    popCardMenu(popupTargetFromElement(anchor), groupKey, rowId, this.logic);
  };

  // MOJO: same auto-open hook as the PC kanban — when the deadlines
  // page parks a `__mojoOpenKanbanCard` request before navigating, the
  // first kanban that owns that row pops the detail panel so the user
  // lands on the card itself instead of the kanban scroll.
  //
  // The data source's rows$ may still be empty when the kanban first
  // mounts (the doc is hydrating), so subscribe and retry on each
  // emit until the row appears or 8 seconds pass.
  private _mojoMaybeOpenPendingCard() {
    const slot = globalThis as unknown as {
      __mojoOpenKanbanCard?: { rowId?: string };
    };
    const pending = slot.__mojoOpenKanbanCard;
    if (!pending?.rowId) return;
    const targetRowId = pending.rowId;
    const view = this.logic.view;

    let opened = false;
    const tryOpen = () => {
      if (opened) return true;
      const rowIds = view.dataSource.rows$.value;
      if (!rowIds.includes(targetRowId)) return false;
      if (slot.__mojoOpenKanbanCard?.rowId !== targetRowId) {
        opened = true;
        return true;
      }
      delete slot.__mojoOpenKanbanCard;
      opened = true;
      requestAnimationFrame(() => {
        try {
          this.logic.root.openDetailPanel({ view, rowId: targetRowId });
        } catch (e) {
          console.warn('[mojo deadline] auto-open card failed', e);
        }
      });
      return true;
    };

    if (tryOpen()) return;
    const subscription = view.dataSource.rows$.subscribe(() => {
      if (tryOpen()) subscription.unsubscribe();
    });
    setTimeout(() => subscription.unsubscribe(), 8000);
  }

  override render(): TemplateResult {
    const groups = this.logic.groupManager.groupsDataList$.value;
    if (!groups) {
      return html``;
    }
    const groupEntries = groups.filter(
      (group): group is NonNullable<(typeof groups)[number]> => group != null
    );
    const vPadding = this.logic.root.config.virtualPadding$.value;
    const wrapperStyle = styleMap({
      marginLeft: `-${vPadding}px`,
      marginRight: `-${vPadding}px`,
      paddingLeft: `${vPadding}px`,
      paddingRight: `${vPadding}px`,
    });
    return html`
      ${renderUniLit(this.logic.headerWidget, {
        dataViewLogic: this.logic,
      })}
      <div class="${mobileKanbanGroups}" style="${wrapperStyle}">
        ${repeat(
          groupEntries,
          group => group.key,
          group => {
            return html` <mobile-kanban-group
              ${sortable(group.key)}
              data-key="${group.key}"
              .kanbanViewLogic="${this.logic}"
              .group="${group}"
            ></mobile-kanban-group>`;
          }
        )}
        ${this.logic.renderAddGroup()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mobile-data-view-kanban-ui': MobileKanbanViewUI;
  }
}
