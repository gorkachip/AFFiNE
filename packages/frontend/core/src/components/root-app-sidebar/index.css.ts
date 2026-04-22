import { style } from '@vanilla-extract/css';

export const brandHeader = style({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'center',
  gap: 8,
  padding: '4px 8px 8px',
  marginTop: -4,
  marginBottom: 6,
  borderBottom: '1px solid #e5dad0',
  userSelect: 'none',
});

export const brandLogoText = style({
  fontFamily: "'Lacquer', cursive",
  fontSize: '32px',
  lineHeight: 1,
  color: '#27241e',
  letterSpacing: '0.5px',
});

export const brandSubtext = style({
  fontFamily: "'DM Sans', sans-serif",
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color: '#6f634f',
  opacity: 0.7,
});

export const workspaceAndUserWrapper = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  width: 'calc(100% + 12px)',
  height: 42,
  paddingRight: 6,
  alignSelf: 'center',
});
export const quickSearchAndNewPage = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
  marginLeft: -8,
  marginRight: -6,
});
export const quickSearch = style({
  width: 0,
  flex: 1,
});

export const workspaceWrapper = style({
  width: 0,
  flex: 1,
});

export const bottomContainer = style({
  gap: 8,
});
