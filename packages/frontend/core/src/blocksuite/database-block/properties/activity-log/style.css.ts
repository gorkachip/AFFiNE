import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const cellRoot = style({
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
});

export const cellPreview = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: '4px 8px',
  fontSize: 12,
  cursor: 'pointer',
  color: cssVarV2('text/secondary'),
});

export const cellIcon = style({
  fontSize: 14,
  flexShrink: 0,
});

export const cellCount = style({
  fontWeight: 500,
  color: cssVarV2('text/primary'),
  flexShrink: 0,
});

export const cellSnippet = style({
  flex: 1,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  color: cssVarV2('text/tertiary'),
});

export const popoverContent = style({
  width: 460,
  maxHeight: 520,
  padding: 0,
  background: cssVarV2('layer/background/primary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 12,
  boxShadow: '0 8px 24px rgba(39, 36, 30, 0.12)',
  overflow: 'hidden',
});

export const popoverInner = style({
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 520,
});
