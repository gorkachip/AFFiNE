import { createModal } from '@blocksuite/affine-components/context-menu';
import { CloseIcon } from '@blocksuite/icons/lit';
import { ShadowlessElement } from '@blocksuite/std';
import { css, html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

export class CenterPeek extends ShadowlessElement {
  static override styles = css`
    center-peek {
      flex-direction: column;
      position: absolute;
      top: 5%;
      left: 5%;
      width: 90%;
      height: 90%;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.05);
      border-radius: 12px;
    }

    .side-modal-content {
      flex: 1;
      overflow-y: auto;
    }

    .close-modal:hover {
      background-color: var(--affine-hover-color);
    }
    .close-modal {
      position: absolute;
      right: -32px;
      top: 0;
      width: 24px;
      height: 24px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
  `;

  override render() {
    return html`
      <div @click="${this.close}" class="close-modal">${CloseIcon()}</div>
      ${this.content}
    `;
  }

  @property({ attribute: false })
  accessor close: (() => void) | undefined = undefined;

  @property({ attribute: false })
  accessor content: TemplateResult | undefined = undefined;
}

// MOJO: the upstream popSideDetail covers the entire viewport, so
// the right sidebar (where comment threads live) ends up buried
// behind the modal backdrop. We measure the right sidebar at open
// time and shrink both the backdrop and the peek so the sidebar
// stays visible and clickable. The observer keeps the layout in
// sync if the user opens / closes / resizes the sidebar while
// the card is open.
const findRightSidebar = (): HTMLElement | null => {
  const panels = document.querySelectorAll<HTMLElement>(
    '[class*="workbenchSidebar"]'
  );
  for (const panel of Array.from(panels)) {
    if (panel.offsetWidth > 0) return panel;
  }
  return null;
};

const measureRightReservedPx = (): number => {
  const panel = findRightSidebar();
  if (!panel) return 0;
  const rect = panel.getBoundingClientRect();
  return Math.max(0, window.innerWidth - rect.left);
};

export const popSideDetail = (template: TemplateResult) => {
  return new Promise<void>(res => {
    const modal = createModal(document.body);
    const sideContainer = new CenterPeek();
    sideContainer.content = template;

    let lastReserved = -1;
    const applyLayout = () => {
      const reserved = measureRightReservedPx();
      if (reserved === lastReserved) return;
      lastReserved = reserved;
      modal.style.width = reserved > 0 ? `calc(100% - ${reserved}px)` : '100%';
      sideContainer.style.right = reserved > 0 ? `${reserved + 24}px` : '5%';
      sideContainer.style.left = '5%';
      sideContainer.style.width = 'auto';
    };
    const intervalId = window.setInterval(applyLayout, 250);

    const close = () => {
      window.clearInterval(intervalId);
      window.removeEventListener('resize', applyLayout);
      modal.remove();
      res();
    };
    sideContainer.close = close;
    modal.onclick = e => e.target === modal && close();
    modal.append(sideContainer);
    applyLayout();
    window.addEventListener('resize', applyLayout);
  });
};
