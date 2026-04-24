import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';
export const trashTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  fontWeight: 600,
  userSelect: 'none',
});
export const body = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  height: '100%',
  width: '100%',
});
export const trashIcon = style({
  color: cssVar('iconColor'),
  fontSize: cssVar('fontH5'),
});

export const trashedFoldersSection = style({
  borderBottom: `1px solid ${cssVar('borderColor')}`,
  padding: '12px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});
export const trashedFoldersHeader = style({
  fontWeight: 600,
  fontSize: cssVar('fontSm'),
  color: cssVar('textSecondaryColor'),
});
export const trashedFoldersList = style({
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});
export const trashedFolderRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderRadius: 4,
  selectors: {
    '&:hover': {
      backgroundColor: cssVar('hoverColor'),
    },
  },
});
export const trashedFolderIcon = style({
  color: cssVar('iconColor'),
  fontSize: 16,
  flexShrink: 0,
});
export const trashedFolderName = style({
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: cssVar('fontBase'),
});
export const trashedFolderTime = style({
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontXs'),
  flexShrink: 0,
});
export const trashedFolderAction = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  border: 'none',
  background: 'transparent',
  color: cssVar('textPrimaryColor'),
  cursor: 'pointer',
  borderRadius: 4,
  fontSize: cssVar('fontXs'),
  selectors: {
    '&:hover': {
      backgroundColor: cssVar('hoverColor'),
    },
  },
});
export const trashedFolderActionDanger = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  border: 'none',
  background: 'transparent',
  color: cssVar('errorColor'),
  cursor: 'pointer',
  borderRadius: 4,
  fontSize: cssVar('fontXs'),
  selectors: {
    '&:hover': {
      backgroundColor: cssVar('hoverColor'),
    },
  },
});
