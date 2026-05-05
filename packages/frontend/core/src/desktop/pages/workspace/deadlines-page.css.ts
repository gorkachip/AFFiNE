import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const title = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  fontWeight: 600,
});

export const titleIcon = style({
  color: cssVar('iconColor'),
  fontSize: cssVar('fontH5'),
});

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  padding: 24,
  gap: 24,
  height: '100%',
  overflowY: 'auto',
});

export const empty = style({
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontBase'),
  textAlign: 'center',
  marginTop: 48,
});

export const bucket = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const bucketHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: cssVar('fontH6'),
  margin: 0,
  color: cssVar('textPrimaryColor'),
});

export const bucketCount = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  background: cssVar('hoverColor'),
  borderRadius: 10,
  padding: '0 8px',
});

export const list = style({
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});

export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  borderRadius: 6,
  border: `1px solid ${cssVar('borderColor')}`,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: cssVar('hoverColor'),
    },
  },
});

export const cardTitle = style({
  flex: 1,
  fontSize: cssVar('fontBase'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const cardDate = style({
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontSm'),
  flexShrink: 0,
});

export const cardDateOverdue = style({
  color: cssVar('errorColor'),
  fontWeight: 600,
});

export const cardDateSnoozed = style({
  fontStyle: 'italic',
});

export const rowActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
});

export const actionButton = style({
  border: 'none',
  background: 'transparent',
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontXs'),
  padding: '4px 8px',
  borderRadius: 4,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover': {
      background: cssVar('hoverColor'),
      color: cssVar('textPrimaryColor'),
    },
  },
});

export const actionButtonPrimary = style([
  actionButton,
  {
    color: cssVar('primaryColor'),
    fontWeight: 500,
  },
]);

export const rowDone = style({
  opacity: 0.55,
  selectors: {
    [`& .${cardTitle}`]: {
      textDecoration: 'line-through',
    },
  },
});
