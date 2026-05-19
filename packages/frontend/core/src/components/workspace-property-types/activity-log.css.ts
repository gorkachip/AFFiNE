import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const triggerContainer = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 8px',
  width: '100%',
  cursor: 'pointer',
  fontSize: 13,
  color: cssVarV2('text/secondary'),
  position: 'relative',
});

export const menuAnchor = style({
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
});

export const triggerCount = style({
  fontWeight: 500,
  color: cssVarV2('text/primary'),
});

export const triggerSnippet = style({
  flex: 1,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  color: cssVarV2('text/tertiary'),
});

export const popoverRoot = style({
  width: 460,
  // MOJO: cap height to the viewport-aware Radix var so the popover
  // never overflows the screen when opened from a low-positioned trigger
  // (e.g. activity log property near the bottom of a peek-view).
  maxHeight: 'min(520px, var(--radix-popper-available-height, 520px))',
  display: 'flex',
  flexDirection: 'column',
  background: cssVarV2('layer/background/primary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 12,
  boxShadow: '0 8px 24px rgba(39, 36, 30, 0.12)',
  overflow: 'hidden',
});

export const entryList = style({
  flex: 1,
  overflowY: 'auto',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
});

export const emptyState = style({
  padding: 32,
  textAlign: 'center',
  color: cssVarV2('text/tertiary'),
  fontSize: 13,
});

export const entry = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '8px 10px',
  borderRadius: 8,
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});

export const entryHead = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  fontSize: 12,
});

export const entryAuthor = style({
  fontWeight: 600,
  color: cssVarV2('text/primary'),
});

export const entryTime = style({
  color: cssVarV2('text/tertiary'),
  fontSize: 11,
});

export const entryActions = style({
  marginLeft: 'auto',
  display: 'flex',
  gap: 4,
  opacity: 0,
  transition: 'opacity 0.15s',
  selectors: {
    [`${entry}:hover &`]: {
      opacity: 1,
    },
  },
});

export const entryActionButton = style({
  border: 'none',
  background: 'transparent',
  color: cssVarV2('text/tertiary'),
  cursor: 'pointer',
  fontSize: 11,
  padding: '2px 6px',
  borderRadius: 4,
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
      color: cssVarV2('text/primary'),
    },
  },
});

export const entryBody = style({
  fontSize: 13,
  lineHeight: 1.45,
  color: cssVarV2('text/primary'),
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

export const mentionToken = style({
  display: 'inline',
  color: cssVarV2('text/emphasis'),
  fontWeight: 500,
  background: cssVarV2('button/actionActive'),
  borderRadius: 3,
  padding: '0 3px',
});

export const replyList = style({
  marginTop: 8,
  marginLeft: 16,
  paddingLeft: 12,
  borderLeft: `2px solid ${cssVarV2('layer/insideBorder/border')}`,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const inputArea = style({
  borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: cssVarV2('layer/background/primary'),
  position: 'relative',
  // MOJO: never let the input row shrink — when the popover is height-
  // constrained the entry list scrolls, the compose box stays visible.
  flexShrink: 0,
});

export const replyingTo = style({
  fontSize: 11,
  color: cssVarV2('text/secondary'),
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 6px',
  background: cssVarV2('layer/background/secondary'),
  borderRadius: 4,
});

export const textarea = style({
  width: '100%',
  minHeight: 56,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  resize: 'vertical',
  outline: 'none',
  // MOJO: keep the textarea visible when the popover is height-bounded;
  // without this the entry list above (flex:1) can squeeze it to 0.
  flexShrink: 0,
  selectors: {
    '&:focus': {
      borderColor: cssVarV2('text/emphasis'),
    },
  },
});

export const footerRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 11,
  color: cssVarV2('text/tertiary'),
});

export const submitButton = style({
  border: 'none',
  background: cssVarV2('text/emphasis'),
  color: cssVarV2('text/pureWhite'),
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  selectors: {
    '&:disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  },
});

export const mentionMenu = style({
  position: 'absolute',
  bottom: '100%',
  left: 16,
  marginBottom: 6,
  background: cssVarV2('layer/background/primary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  boxShadow: '0 4px 12px rgba(39, 36, 30, 0.12)',
  maxHeight: 220,
  overflowY: 'auto',
  minWidth: 220,
  zIndex: 10,
});

export const mentionItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  cursor: 'pointer',
  fontSize: 13,
  selectors: {
    '&:hover, &[data-active="true"]': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});

export const docListContainer = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});

export const previewTooltip = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  maxWidth: 320,
  padding: 4,
});

export const previewEntry = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
});

export const previewHead = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  fontSize: 11,
});

export const previewAuthor = style({
  fontWeight: 600,
});

export const previewTime = style({
  opacity: 0.7,
  fontSize: 10,
});

export const previewBody = style({
  fontSize: 12,
  lineHeight: 1.4,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});
