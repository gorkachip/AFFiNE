import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const empty = style({
  padding: 24,
  color: cssVar('textSecondaryColor'),
  textAlign: 'center',
});

export const list = style({
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const item = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '8px 12px',
  borderRadius: 6,
  border: `1px solid ${cssVar('borderColor')}`,
});

export const head = style({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
});

export const action = style({
  fontWeight: 500,
  fontSize: cssVar('fontBase'),
});

export const time = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
});

export const body = style({
  fontSize: cssVar('fontSm'),
  color: cssVar('textSecondaryColor'),
});
