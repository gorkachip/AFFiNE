import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const cellRoot = style({
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  padding: '4px 8px',
});

export const dateInput = style({
  width: '100%',
  border: 'none',
  background: 'transparent',
  padding: 0,
  font: 'inherit',
  color: cssVarV2('text/primary'),
  outline: 'none',
});

export const dateReadonly = style({
  width: '100%',
  color: cssVarV2('text/secondary'),
  cursor: 'not-allowed',
});
