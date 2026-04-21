import { memo } from 'react';

export default memo(function Logo() {
  return (
    <img
      src="/imgs/mojo-logo.png"
      alt="MOJO Notion"
      width={120}
      height={120}
      style={{ objectFit: 'contain' }}
    />
  );
});
