import clsx from 'clsx';
import type { FC } from 'react';

import { authHeaderWrapper } from './share.css';

export const AuthHeader: FC<{
  title: string;
  subTitle?: string;
  className?: string;
}> = ({ title, subTitle, className }) => {
  return (
    <div className={clsx(authHeaderWrapper, className)}>
      <p>
        <img
          src="/imgs/mojo-logo.png"
          alt="MOJO Notion"
          className="logo"
          width={28}
          height={28}
          style={{ objectFit: 'contain', verticalAlign: 'middle' }}
        />
        {title}
      </p>
      <p>{subTitle}</p>
    </div>
  );
};
