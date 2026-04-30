import {
  menu,
  popFilterableSimpleMenu,
  popupTargetFromElement,
} from '@blocksuite/affine-components/context-menu';
import { SignalWatcher, WithDisposable } from '@blocksuite/global/lit';
import { AddCursorIcon } from '@blocksuite/icons/lit';
import { ShadowlessElement } from '@blocksuite/std';
import { css, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { html } from 'lit/static-html.js';

import { GroupTitle } from '../../../core/group-by/group-title.js';
import type { Group } from '../../../core/group-by/trait.js';
import { dragHandler } from '../../../core/utils/wc-dnd/dnd-context.js';
import type { MobileKanbanViewUILogic } from './kanban-view-ui-logic.js';

const styles = css`
  mobile-kanban-group {
    width: 260px;
    flex-shrink: 0;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
  }

  .mobile-group-header {
    height: 32px;
    padding: 6px 4px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    overflow: hidden;
  }

  .mobile-group-body {
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    padding: 0 4px;
    gap: 12px;
  }

  .mobile-add-card {
    display: flex;
    align-items: center;
    padding: 4px;
    border-radius: 4px;
    font-size: var(--data-view-cell-text-size);
    line-height: var(--data-view-cell-text-line-height);
    color: var(--affine-text-secondary-color);
  }
`;

export class MobileKanbanGroup extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  static override styles = styles;

  private readonly clickAddCard = () => {
    this.view.addCard('end', this.group.key);
    this.requestUpdate();
  };

  private readonly clickAddCardInStart = () => {
    this.view.addCard('start', this.group.key);
    this.requestUpdate();
  };

  // MOJO: see kanban/pc/group.ts for the rationale — same gate, just
  // wired into the mobile menu shape.
  private get _mojoIsOwnerOrAdmin(): boolean {
    const auth = (
      globalThis as unknown as {
        __mojoAuthContext?: { userId: string | null; isOwnerOrAdmin: boolean };
      }
    ).__mojoAuthContext;
    return auth?.isOwnerOrAdmin ?? true;
  }

  private get _mojoSiblingGroups(): Array<{ key: string; name: string }> {
    const groupMap = this.group.manager.groupDataMap$.value ?? {};
    return Object.values(groupMap)
      .filter(g => g.key !== this.group.key && g.value != null)
      .map(g => ({ key: g.key, name: g.name$.value || 'Untitled' }));
  }

  private _mojoRemoveOption(propertyId: string) {
    const prop = this.view.propertyGetOrCreate(propertyId);
    if (!prop) return;
    prop.dataUpdate(prev => {
      if (
        prev &&
        typeof prev === 'object' &&
        'options' in prev &&
        Array.isArray((prev as { options?: unknown[] }).options)
      ) {
        const data = prev as { options: Array<{ id: string }> };
        return {
          ...data,
          options: data.options.filter(o => o.id !== this.group.key),
        };
      }
      return prev;
    });
  }

  private readonly clickGroupOptions = (e: MouseEvent) => {
    const ele = e.currentTarget as HTMLElement;
    const siblings = this._mojoSiblingGroups;
    const isAdmin = this._mojoIsOwnerOrAdmin;
    const cardCount = this.group.rows.length;
    const hasGroupValue = this.group.value != null;
    const propertyId = () => this.group.manager.property$.value?.id;

    popFilterableSimpleMenu(popupTargetFromElement(ele), [
      menu.group({
        items: [
          menu.action({
            name: 'Ungroup',
            hide: () => this.group.value == null,
            select: () => {
              this.group.rows.forEach(row => {
                this.group.manager.removeFromGroup(row.rowId, this.group.key);
              });
              this.requestUpdate();
            },
          }),
          menu.action({
            name: 'Delete Cards',
            select: () => {
              this.view.rowsDelete(this.group.rows.map(row => row.rowId));
              this.requestUpdate();
            },
          }),
          menu.subMenu({
            name: 'Delete status',
            hide: () => !hasGroupValue || !isAdmin,
            options: {
              items: [
                ...siblings.map(sibling =>
                  menu.action({
                    name:
                      cardCount === 0
                        ? 'Delete (no cards)'
                        : `Move ${cardCount} card${cardCount === 1 ? '' : 's'} to "${sibling.name}"`,
                    hide: () =>
                      cardCount === 0 && siblings.indexOf(sibling) > 0,
                    select: () => {
                      const pid = propertyId();
                      if (!pid) return;
                      this.group.rows.forEach(row => {
                        this.group.manager.moveCardTo(
                          row.rowId,
                          this.group.key,
                          sibling.key,
                          'end'
                        );
                      });
                      this._mojoRemoveOption(pid);
                      this.requestUpdate();
                    },
                  })
                ),
                menu.action({
                  name:
                    cardCount === 0
                      ? 'Delete empty status'
                      : `Trash ${cardCount} card${cardCount === 1 ? '' : 's'} and delete`,
                  class: { 'delete-item': true },
                  select: () => {
                    const pid = propertyId();
                    if (cardCount > 0) {
                      this.view.rowsDelete(
                        this.group.rows.map(row => row.rowId)
                      );
                    }
                    if (pid) this._mojoRemoveOption(pid);
                    this.requestUpdate();
                  },
                }),
              ],
            },
          }),
        ],
      }),
    ]);
  };

  override render() {
    const cards = this.group.rows;
    return html`
      <div class="mobile-group-header" ${dragHandler(this.group.key)}>
        ${GroupTitle(this.group, {
          readonly: this.view.readonly$.value,
          clickAdd: this.clickAddCardInStart,
          clickOps: this.clickGroupOptions,
        })}
      </div>
      <div class="mobile-group-body">
        ${repeat(
          cards,
          row => row.rowId,
          row => {
            return html`
              <mobile-kanban-card
                data-card-id="${row.rowId}"
                .groupKey="${this.group.key}"
                .cardId="${row.rowId}"
                .kanbanViewLogic="${this.kanbanViewLogic}"
              ></mobile-kanban-card>
            `;
          }
        )}
        ${this.view.readonly$.value
          ? nothing
          : html` <div class="mobile-add-card" @click="${this.clickAddCard}">
              <div
                style="margin-right: 4px;width: 16px;height: 16px;display:flex;align-items:center;"
              >
                ${AddCursorIcon()}
              </div>
              Add
            </div>`}
      </div>
    `;
  }

  @property({ attribute: false })
  accessor group!: Group;

  @property({ attribute: false })
  accessor kanbanViewLogic!: MobileKanbanViewUILogic;

  get view() {
    return this.kanbanViewLogic.view;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mobile-kanban-group': MobileKanbanGroup;
  }
}
