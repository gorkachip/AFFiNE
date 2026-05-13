import { CaptionedBlockComponent } from '@blocksuite/affine-components/caption';
import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/affine-components/context-menu';
import { DropIndicator } from '@blocksuite/affine-components/drop-indicator';
import { PeekViewProvider } from '@blocksuite/affine-components/peek';
import { toast } from '@blocksuite/affine-components/toast';
import type { DatabaseBlockModel } from '@blocksuite/affine-model';
import { EDGELESS_TOP_CONTENTEDITABLE_SELECTOR } from '@blocksuite/affine-shared/consts';
import {
  BlockElementCommentManager,
  CommentProviderIdentifier,
  DocModeProvider,
  FeatureFlagService,
  NotificationProvider,
  type TelemetryEventMap,
  TelemetryProvider,
} from '@blocksuite/affine-shared/services';
import { getDropResult } from '@blocksuite/affine-widget-drag-handle';
import {
  createRecordDetail,
  createUniComponentFromWebComponent,
  DataViewRootUILogic,
  type DataViewSelection,
  type DataViewUILogicBase,
  type DataViewWidget,
  type DataViewWidgetProps,
  defineUniComponent,
  ExternalGroupByConfigProvider,
  lazy,
  renderUniLit,
  type SingleView,
  uniMap,
} from '@blocksuite/data-view';
import { widgetPresets } from '@blocksuite/data-view/widget-presets';
import { IS_MOBILE } from '@blocksuite/global/env';
import { Rect } from '@blocksuite/global/gfx';
import {
  CommentIcon,
  CopyIcon,
  DeleteIcon,
  ExpandFullIcon,
  MoreHorizontalIcon,
  ResetIcon,
} from '@blocksuite/icons/lit';
import { type BlockComponent, BlockSelection } from '@blocksuite/std';
import { RANGE_SYNC_EXCLUDE_ATTR } from '@blocksuite/std/inline';
import { Slice } from '@blocksuite/store';
import { autoUpdate } from '@floating-ui/dom';
import { computed, signal } from '@preact/signals-core';
import { html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';

import { popSideDetail } from './components/layout.js';
import { DatabaseConfigExtension } from './config.js';
import { EditorHostKey } from './context/host-context.js';
import { DatabaseBlockDataSource } from './data-source.js';
import {
  databaseBlockStyles,
  databaseContentStyles,
  databaseHeaderBarStyles,
  databaseHeaderContainerStyles,
  databaseOpsStyles,
  databaseTitleRowStyles,
  databaseTitleStyles,
  databaseToolbarRowStyles,
  databaseViewBarContainerStyles,
} from './database-block-styles.js';
import { BlockRenderer } from './detail-panel/block-renderer.js';
import { NoteRenderer } from './detail-panel/note-renderer.js';
import { DatabaseSelection } from './selection.js';
import { currentViewStorage } from './utils/current-view.js';
import { getSingleDocIdFromText } from './utils/title-doc.js';
import type { DatabaseViewExtensionOptions } from './view';

// MOJO: short relative-time string for the per-kanban Trash entries.
function formatTrashAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export class DatabaseBlockComponent extends CaptionedBlockComponent<DatabaseBlockModel> {
  private readonly clickDatabaseOps = (e: MouseEvent) => {
    const options = this.optionsConfig.configure(this.model, {
      items: [
        menu.input({
          initialValue: this.model.props.title.toString(),
          placeholder: 'Database title',
          onChange: text => {
            this.model.props.title.replace(
              0,
              this.model.props.title.length,
              text
            );
          },
        }),
        menu.action({
          prefix: CommentIcon(),
          name: 'Comment',
          hide: () => !this.std.getOptional(CommentProviderIdentifier),
          select: () => {
            this.std.getOptional(CommentProviderIdentifier)?.addComment([
              new BlockSelection({
                blockId: this.blockId,
              }),
            ]);
          },
        }),
        menu.action({
          prefix: CopyIcon(),
          name: 'Copy',
          select: () => {
            const slice = Slice.fromModels(this.store, [this.model]);
            this.std.clipboard
              .copySlice(slice)
              .then(() => {
                toast(this.host, 'Copied to clipboard');
              })
              .catch(console.error);
          },
        }),
        // MOJO: per-kanban Trash entry, visible only to workspace
        // owners/admins. Lists soft-deleted rows with Restore + Delete
        // forever actions.
        menu.dynamic(() => {
          const auth = (
            globalThis as unknown as {
              __mojoAuthContext?: {
                userId: string | null;
                isOwnerOrAdmin: boolean;
              };
            }
          ).__mojoAuthContext;
          if (!auth) return [];
          const ds = this.dataSource.value;
          const allTrashed = ds.trashedRows$.value;
          if (allTrashed.length === 0) return [];
          // Non-admins only see trashed cards they created themselves so
          // they can undo their own accidental deletes; admins see all.
          const visibleIds = auth.isOwnerOrAdmin
            ? allTrashed
            : allTrashed.filter(id => {
                const m = ds.doc.getBlock(id)?.model as
                  | { props?: { 'meta:createdBy'?: string } }
                  | undefined;
                return m?.props?.['meta:createdBy'] === auth.userId;
              });
          if (visibleIds.length === 0) return [];
          // Newest-trashed first.
          const sorted = [...visibleIds].sort((a, b) => {
            const ta = (
              ds.doc.getBlock(a)?.model as
                | { props?: { 'meta:trashedAt'?: number } }
                | undefined
            )?.props?.['meta:trashedAt'];
            const tb = (
              ds.doc.getBlock(b)?.model as
                | { props?: { 'meta:trashedAt'?: number } }
                | undefined
            )?.props?.['meta:trashedAt'];
            return (tb ?? 0) - (ta ?? 0);
          });
          const canPermaDelete = auth.isOwnerOrAdmin;
          const bulkActions = [
            menu.action({
              prefix: ResetIcon(),
              name: 'Restore all',
              select: () => {
                ds.rowRestore([...sorted]);
              },
            }),
            ...(canPermaDelete
              ? [
                  menu.action({
                    prefix: DeleteIcon(),
                    class: { 'delete-item': true },
                    name: 'Empty trash',
                    select: () => {
                      ds.rowPermaDelete([...sorted]);
                    },
                  }),
                ]
              : []),
          ];
          return [
            menu.subMenu({
              name: `Trash (${sorted.length})`,
              prefix: DeleteIcon(),
              options: {
                items: [
                  menu.group({ items: bulkActions }),
                  ...sorted.map(rowId => {
                    const model = ds.doc.getBlock(rowId)?.model as
                      | {
                          text?: { toString(): string };
                          props?: { 'meta:trashedAt'?: number };
                        }
                      | undefined;
                    const titleText = model?.text?.toString().trim() ?? '';
                    // If the row title is empty (common when the kanban
                    // uses other columns as primary info) walk the
                    // configured columns and pick the first non-empty
                    // cell value as a hint so admins can recognise the
                    // card without opening it.
                    let descriptor = titleText;
                    if (!descriptor) {
                      for (const propertyId of ds.properties$.value) {
                        if (propertyId === 'title') continue;
                        const cell = ds.cellValueGet(rowId, propertyId);
                        if (cell == null) continue;
                        const asText =
                          typeof cell === 'string'
                            ? cell
                            : Array.isArray(cell)
                              ? cell.join(', ')
                              : typeof cell === 'object'
                                ? JSON.stringify(cell)
                                : String(cell);
                        const trimmed = asText.trim();
                        if (trimmed && trimmed !== '[]' && trimmed !== '{}') {
                          descriptor = trimmed;
                          break;
                        }
                      }
                    }
                    if (!descriptor) descriptor = `Row ${rowId.slice(0, 6)}`;
                    const trashedAt = model?.props?.['meta:trashedAt'];
                    const ago = trashedAt ? formatTrashAgo(trashedAt) : '';
                    const label = `${descriptor.length > 36 ? `${descriptor.slice(0, 36)}…` : descriptor}${ago ? `  ·  ${ago}` : ''}`;
                    const rowActions = [
                      menu.action({
                        prefix: ExpandFullIcon(),
                        name: 'View',
                        select: () => {
                          const view = ds.viewManager.currentView$.value;
                          if (!view) return;
                          popSideDetail(
                            this.createTemplate({ view, rowId }, () => {})
                          ).catch(console.error);
                        },
                      }),
                      menu.action({
                        prefix: ResetIcon(),
                        name: 'Restore',
                        select: () => {
                          ds.rowRestore([rowId]);
                        },
                      }),
                      ...(canPermaDelete
                        ? [
                            menu.action({
                              prefix: DeleteIcon(),
                              class: { 'delete-item': true },
                              name: 'Delete forever',
                              select: () => {
                                ds.rowPermaDelete([rowId]);
                              },
                            }),
                          ]
                        : []),
                    ];
                    return menu.subMenu({
                      name: label,
                      options: { items: rowActions },
                    });
                  }),
                ],
              },
            }),
          ];
        }),
        menu.group({
          items: [
            menu.action({
              prefix: DeleteIcon(),
              class: {
                'delete-item': true,
              },
              name: 'Delete Database',
              select: () => {
                // MOJO: gate at the click handler so we get a clear toast
                // instead of relying on the framework gate's silent skip.
                const ctx = (
                  globalThis as unknown as {
                    __mojoAuthContext?: {
                      userId: string | null;
                      isOwnerOrAdmin: boolean;
                    };
                  }
                ).__mojoAuthContext;
                const createdBy = (
                  this.model.props as { 'meta:createdBy'?: string }
                )['meta:createdBy'];
                if (
                  ctx &&
                  !ctx.isOwnerOrAdmin &&
                  createdBy &&
                  createdBy !== ctx.userId
                ) {
                  document.dispatchEvent(
                    new CustomEvent('mojo-delete-blocked', {
                      detail: {
                        message:
                          'Only the database creator or a workspace admin can delete this database.',
                      },
                    })
                  );
                  return;
                }
                this.model.children.slice().forEach(block => {
                  this.store.deleteBlock(block);
                });
                this.store.deleteBlock(this.model);
              },
            }),
          ],
        }),
      ],
    });

    popMenu(popupTargetFromElement(e.currentTarget as HTMLElement), {
      options,
    });
  };

  private readonly dataSource = lazy(() => {
    const dataSource = new DatabaseBlockDataSource(this.model, dataSource => {
      dataSource.serviceSet(EditorHostKey, this.host);
      this.std.provider
        .getAll(ExternalGroupByConfigProvider)
        .forEach(config => {
          dataSource.serviceSet(
            ExternalGroupByConfigProvider(config.name),
            config
          );
        });
    });
    const id = currentViewStorage.getCurrentView(this.model.id);
    if (id && dataSource.viewManager.viewGet(id)) {
      dataSource.viewManager.setCurrentView(id);
    }
    return dataSource;
  });

  private readonly renderTitle = (dataViewLogic: DataViewUILogicBase) => {
    return html` <affine-database-title
      class="${databaseTitleStyles}"
      .titleText="${this.model.props.title}"
      .dataViewLogic="${dataViewLogic}"
    ></affine-database-title>`;
  };

  createTemplate = (
    data: {
      view: SingleView;
      rowId: string;
    },
    openDoc: (docId: string) => void
  ) => {
    return createRecordDetail({
      ...data,
      openDoc,
      detail: {
        header: uniMap(
          createUniComponentFromWebComponent(BlockRenderer),
          props => ({
            ...props,
            host: this.host,
          })
        ),
        note: uniMap(
          createUniComponentFromWebComponent(NoteRenderer),
          props => ({
            ...props,
            model: this.model,
            host: this.host,
          })
        ),
      },
    });
  };

  headerWidget: DataViewWidget = defineUniComponent(
    (props: DataViewWidgetProps) => {
      return html`
        <div class="${databaseHeaderContainerStyles}">
          <div class="${databaseTitleRowStyles}">
            ${this.renderTitle(props.dataViewLogic)} ${this.renderDatabaseOps()}
          </div>
          <div class="${databaseToolbarRowStyles} ${databaseHeaderBarStyles}">
            <div class="${databaseViewBarContainerStyles}">
              ${renderUniLit(widgetPresets.viewBar, {
                ...props,
                onChangeView: id => {
                  currentViewStorage.setCurrentView(this.blockId, id);
                },
              })}
            </div>
            ${renderUniLit(this.toolsWidget, props)}
          </div>
          ${renderUniLit(widgetPresets.quickSettingBar, props)}
        </div>
      `;
    }
  );

  indicator = new DropIndicator();

  onDrag = (evt: MouseEvent, id: string): (() => void) => {
    const result = getDropResult(evt);
    if (result && result.rect) {
      document.body.append(this.indicator);
      this.indicator.rect = Rect.fromLWTH(
        result.rect.left,
        result.rect.width,
        result.rect.top,
        result.rect.height
      );
      return () => {
        this.indicator.remove();
        const model = this.store.getBlock(id)?.model;
        const target = result.modelState.model;
        let parent = this.store.getParent(target.id);
        const shouldInsertIn = result.placement === 'in';
        if (shouldInsertIn) {
          parent = target;
        }
        if (model && target && parent) {
          if (shouldInsertIn) {
            this.store.moveBlocks([model], parent);
          } else {
            this.store.moveBlocks(
              [model],
              parent,
              target,
              result.placement === 'before'
            );
          }
        }
      };
    }
    this.indicator.remove();
    return () => {};
  };

  private readonly setSelection = (
    selection: DataViewSelection | undefined
  ) => {
    if (selection) {
      getSelection()?.removeAllRanges();
    }
    this.selection.setGroup(
      'note',
      selection
        ? [
            new DatabaseSelection({
              blockId: this.blockId,
              viewSelection: selection,
            }),
          ]
        : []
    );
  };

  private readonly toolsWidget: DataViewWidget = widgetPresets.createTools({
    table: [
      widgetPresets.tools.filter,
      widgetPresets.tools.sort,
      widgetPresets.tools.search,
      widgetPresets.tools.viewOptions,
      widgetPresets.tools.tableAddRow,
    ],
    kanban: [
      widgetPresets.tools.filter,
      widgetPresets.tools.sort,
      widgetPresets.tools.search,
      widgetPresets.tools.viewOptions,
      widgetPresets.tools.tableAddRow,
    ],
  });

  private readonly viewSelection$ = computed(() => {
    const databaseSelection = this.selection.value.find(
      (selection): selection is DatabaseSelection => {
        if (selection.blockId !== this.blockId) {
          return false;
        }
        return selection instanceof DatabaseSelection;
      }
    );
    return databaseSelection?.viewSelection;
  });

  private readonly virtualPadding$ = signal(0);

  get optionsConfig(): DatabaseViewExtensionOptions {
    return {
      configure: (_model, options) => options,
      ...this.std.getOptional(DatabaseConfigExtension.identifier),
    };
  }

  get isCommentHighlighted() {
    return (
      this.std
        .getOptional(BlockElementCommentManager)
        ?.isBlockCommentHighlighted(this.model) ?? false
    );
  }

  override get topContenteditableElement() {
    if (this.std.get(DocModeProvider).getEditorMode() === 'edgeless') {
      return this.closest<BlockComponent>(
        EDGELESS_TOP_CONTENTEDITABLE_SELECTOR
      );
    }
    return this.rootComponent;
  }

  private renderDatabaseOps() {
    if (this.dataSource.value.readonly$.value) {
      return nothing;
    }
    return html` <div
      data-testid="database-ops"
      class="${databaseOpsStyles}"
      @click="${this.clickDatabaseOps}"
    >
      ${MoreHorizontalIcon()}
    </div>`;
  }

  override connectedCallback() {
    super.connectedCallback();

    this.setAttribute(RANGE_SYNC_EXCLUDE_ATTR, 'true');
    this.classList.add(databaseBlockStyles);
    this.listenFullWidthChange();
    this.handleMobileEditing();
    this._mojoRegisterRowDetailHandler();
    this._mojoMaybeOpenPending();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    const registry = (
      globalThis as { __mojoRowDetailHandlers?: Set<DatabaseBlockComponent> }
    ).__mojoRowDetailHandlers;
    registry?.delete(this);
    document.removeEventListener(
      'mojo-open-kanban-card',
      this._mojoOnOpenCardEvent as EventListener
    );
    document.removeEventListener(
      'mojo-open-card-by-block',
      this._mojoOnOpenCardByBlockEvent as EventListener
    );
  }

  // MOJO: each database registers itself in a global set so the
  // /deadlines page can iterate and ask "do you own this rowId?"
  // without going through openDetailPanel — that path prefers linked
  // docs over the row's own detail and was the cause of "click opens
  // the doc, not the card".
  private _mojoRegisterRowDetailHandler() {
    const slot = globalThis as {
      __mojoRowDetailHandlers?: Set<DatabaseBlockComponent>;
    };
    if (!slot.__mojoRowDetailHandlers) {
      slot.__mojoRowDetailHandlers = new Set();
    }
    slot.__mojoRowDetailHandlers.add(this);
    document.addEventListener(
      'mojo-open-kanban-card',
      this._mojoOnOpenCardEvent as EventListener
    );
    document.addEventListener(
      'mojo-open-card-by-block',
      this._mojoOnOpenCardByBlockEvent as EventListener
    );
  }

  private readonly _mojoOnOpenCardEvent = (
    event: CustomEvent<{ rowId?: string }>
  ) => {
    const rowId = event.detail?.rowId;
    if (!rowId) return;
    this.mojoTryOpenRowDetail(rowId);
  };

  // MOJO: covers the "doc was already open when the user clicked a
  // notification" case — the database block is already mounted, so
  // the global-on-mount check never re-runs. Only act when blockId
  // IS a row directly (activity-log mentions stamp rowId as
  // blockId). For @-mentions typed in doc body or in comment
  // threads, blockId is a sub-block — popping the card would cover
  // the thread sidebar / doc location the user actually wants to
  // see, so leave navigation to the standard jumpToPageBlock.
  private readonly _mojoOnOpenCardByBlockEvent = (
    event: CustomEvent<{ blockId?: string }>
  ) => {
    const blockId = event.detail?.blockId;
    if (!blockId) return;
    if (this.model.children?.some(c => c.id === blockId)) {
      this.mojoTryOpenRowDetail(blockId);
    }
  };

  // MOJO: handle the request the deadlines page (or any other
  // shortcut that knows the row id directly) parked before
  // navigating. The row may not be in this.model.children yet —
  // doc is still hydrating — so retry on every blockUpdated emit
  // until the row appears or 8 seconds elapse.
  private _mojoMaybeOpenPending() {
    const slot = globalThis as unknown as {
      __mojoOpenKanbanCard?: { rowId?: string };
      __mojoOpenKanbanCardByBlockId?: { blockId?: string };
      __mojoOpenKanbanCardByCommentId?: { commentId?: string };
    };

    const openRowAncestor = (
      blockId: string,
      consumedFlag: () => void
    ): boolean => {
      const block = this.model.store.getBlock(blockId);
      if (!block) return false;
      let cur: { id: string; parent?: { id: string } | null } | null =
        block.model;
      while (cur && cur.id !== this.model.id) {
        if (this.model.children?.some(c => c.id === cur!.id)) {
          consumedFlag();
          this.mojoTryOpenRowDetail(cur.id);
          return true;
        }
        cur = cur.parent ?? null;
      }
      return false;
    };

    const tryRow = (): boolean => {
      const pending = slot.__mojoOpenKanbanCard;
      const rowId = pending?.rowId;
      if (!rowId) return false;
      if (!this.model.children?.some(c => c.id === rowId)) return false;
      if (slot.__mojoOpenKanbanCard?.rowId !== rowId) return true;
      delete slot.__mojoOpenKanbanCard;
      this.mojoTryOpenRowDetail(rowId);
      return true;
    };

    // Notifications with a known blockId. Only act when the
    // blockId IS a row directly (activity-log mentions stamp rowId
    // as blockId). For @-mentions inside doc body or comment
    // threads, blockId is a sub-block — popping the card would
    // hide the location/thread the user came to read.
    const tryByBlockId = (): boolean => {
      const pending = slot.__mojoOpenKanbanCardByBlockId;
      const blockId = pending?.blockId;
      if (!blockId) return false;
      if (!this.model.children?.some(c => c.id === blockId)) return false;
      if (slot.__mojoOpenKanbanCardByBlockId?.blockId !== blockId) return true;
      delete slot.__mojoOpenKanbanCardByBlockId;
      this.mojoTryOpenRowDetail(blockId);
      return true;
    };

    // Comment-mention notifications carry only a commentId. AFFiNE
    // attaches comments to blocks two ways depending on what was
    // selected when the comment was made:
    //   1. inline text — the commentId is encoded as a
    //      `comment-${id}` attribute in the block's text delta.
    //   2. block-level — the commentId lives in
    //      `block.props.comments` (a map keyed by commentId).
    // Scan for both, then walk up from any matching block to its
    // database row.
    const tryByCommentId = (): boolean => {
      const pending = slot.__mojoOpenKanbanCardByCommentId;
      const commentId = pending?.commentId;
      if (!commentId) return false;
      const target = `comment-${commentId}`;
      const models = this.model.store.getAllModels?.() ?? [];
      console.log('[mojo notif] tryByCommentId', {
        commentId,
        databaseId: this.model.id,
        rowCount: this.model.children?.length,
        modelCount: models.length,
      });
      const consumeFlag = () => {
        if (slot.__mojoOpenKanbanCardByCommentId?.commentId === commentId) {
          delete slot.__mojoOpenKanbanCardByCommentId;
        }
      };
      for (const model of models) {
        let hasComment = false;
        // (1) inline-text comment
        if (model.text) {
          try {
            model.text.toDelta().forEach(d => {
              if (d?.attributes && target in d.attributes) {
                hasComment = true;
              }
            });
          } catch {
            // ignore decode failures
          }
        }
        // (2) block-level comment — props.comments is a map keyed
        // by commentId. We don't care about the value's shape, only
        // whether the key is present.
        if (!hasComment) {
          const blockComments = (
            model as { props?: { comments?: Record<string, unknown> } }
          ).props?.comments;
          if (blockComments && commentId in blockComments) {
            hasComment = true;
          }
        }
        if (!hasComment) continue;
        console.log('[mojo notif] found commented block', {
          commentId,
          blockId: model.id,
          flavour: (model as { flavour?: string }).flavour,
        });
        if (openRowAncestor(model.id, consumeFlag)) {
          console.log('[mojo notif] opened row detail');
          return true;
        }
        console.log(
          '[mojo notif] block found but no row ancestor in this database'
        );
      }
      console.log('[mojo notif] no commented block found in this database doc');
      return false;
    };

    const tryOpen = () => tryRow() || tryByBlockId() || tryByCommentId();
    if (tryOpen()) return;
    const subscription = this.model.store.slots.blockUpdated.subscribe(() => {
      if (tryOpen()) subscription.unsubscribe();
    });
    setTimeout(() => subscription.unsubscribe(), 8000);
  }

  /** Open the row's own detail panel using the same peek-view path
   *  the kanban click takes — keeps both flows consistent and
   *  lets the activity log modal stack correctly on top. The
   *  peek-view's "click outside closes" behaviour is suppressed
   *  in modal-container so clicking in the comments / threads
   *  sidebar doesn't kill the card. */
  mojoTryOpenRowDetail(rowId: string): boolean {
    if (!this.model.children?.some(c => c.id === rowId)) return false;
    const view = this.dataSource.value.viewManager.currentView$.value;
    if (!view) return false;
    requestAnimationFrame(() => {
      const peekViewService = this.std.getOptional(PeekViewProvider);
      if (peekViewService) {
        const abort = new AbortController();
        peekViewService
          .peek(
            {
              target: this,
              template: this.createTemplate({ view, rowId }, docId => {
                peekViewService
                  .peek({
                    docId,
                    databaseId: this.blockId,
                    databaseDocId: this.model.store.id,
                    databaseRowId: rowId,
                    target: this,
                  })
                  .catch(() => {});
              }),
            },
            { abortSignal: abort.signal }
          )
          .catch(e => {
            console.warn('[mojo detail] peekView failed', e);
          });
        return;
      }
      popSideDetail(
        this.createTemplate({ view, rowId }, () => {
          // No-op: the side detail close button cleans up itself.
        })
      ).catch(e => {
        console.warn('[mojo detail] popSideDetail failed', e);
      });
    });
    return true;
  }

  listenFullWidthChange() {
    if (this.std.get(DocModeProvider).getEditorMode() === 'edgeless') {
      return;
    }
    this.disposables.add(
      autoUpdate(this.host, this, () => {
        const padding =
          this.getBoundingClientRect().left -
          this.host.getBoundingClientRect().left;
        this.virtualPadding$.value = Math.max(0, padding - 72);
      })
    );
  }

  handleMobileEditing() {
    if (!IS_MOBILE) return;

    let notifyClosed = true;
    const handler = () => {
      if (
        !this.std
          .get(FeatureFlagService)
          .getFlag('enable_mobile_database_editing')
      ) {
        const notification = this.std.getOptional(NotificationProvider);
        if (notification && notifyClosed) {
          notifyClosed = false;
          notification.notify({
            title: html`<div
              style=${styleMap({
                whiteSpace: 'wrap',
              })}
            >
              Mobile database editing is not supported yet. You can open it in
              experimental features, or edit it in desktop mode.
            </div>`,
            accent: 'warning',
            onClose: () => {
              notifyClosed = true;
            },
          });
        }
      }
    };

    this.disposables.addFromEvent(this, 'click', handler);
  }

  private readonly dataViewRootLogic = lazy(
    () =>
      new DataViewRootUILogic({
        virtualPadding$: this.virtualPadding$,
        bindHotkey: hotkeys => {
          return {
            dispose: this.host.event.bindHotkey(hotkeys, {
              blockId: this.topContenteditableElement?.blockId ?? this.blockId,
            }),
          };
        },
        handleEvent: (name, handler) => {
          return {
            dispose: this.host.event.add(name, handler, {
              blockId: this.blockId,
            }),
          };
        },
        selection$: this.viewSelection$,
        setSelection: this.setSelection,
        dataSource: this.dataSource.value,
        headerWidget: this.headerWidget,
        onDrag: this.onDrag,
        clipboard: this.std.clipboard,
        notification: {
          toast: message => {
            const notification = this.std.getOptional(NotificationProvider);
            if (notification) {
              notification.toast(message);
            } else {
              toast(this.host, message);
            }
          },
        },
        eventTrace: (key, params) => {
          const telemetryService = this.std.getOptional(TelemetryProvider);
          telemetryService?.track(key, {
            ...(params as TelemetryEventMap[typeof key]),
            blockId: this.blockId,
          });
        },
        detailPanelConfig: {
          openDetailPanel: (target, data) => {
            const peekViewService = this.std.getOptional(PeekViewProvider);
            if (peekViewService) {
              const openDoc = (docId: string) => {
                return peekViewService.peek({
                  docId,
                  databaseId: this.blockId,
                  databaseDocId: this.model.store.id,
                  databaseRowId: data.rowId,
                  target: this,
                });
              };
              const doc = getSingleDocIdFromText(
                this.model.store.getBlock(data.rowId)?.model?.text
              );
              if (doc) {
                return openDoc(doc);
              }
              const abort = new AbortController();
              return new Promise<void>(focusBack => {
                peekViewService
                  .peek(
                    {
                      target,
                      template: this.createTemplate(data, docId => {
                        // abort.abort();
                        openDoc(docId).then(focusBack).catch(focusBack);
                      }),
                    },
                    { abortSignal: abort.signal }
                  )
                  .then(focusBack)
                  .catch(focusBack);
              });
            } else {
              return popSideDetail(
                this.createTemplate(data, () => {
                  //
                })
              );
            }
          },
        },
      })
  );
  override renderBlock() {
    const widgets = html`${repeat(
      Object.entries(this.widgets),
      ([id]) => id,
      ([_, widget]) => widget
    )}`;

    return html`
      <div contenteditable="false" class="${databaseContentStyles}">
        ${this.dataViewRootLogic.value.render()} ${widgets}
      </div>
    `;
  }

  override accessor useZeroWidth = true;
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-database': DatabaseBlockComponent;
  }
}
