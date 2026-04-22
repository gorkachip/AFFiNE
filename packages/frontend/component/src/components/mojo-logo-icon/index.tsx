import type { CSSProperties } from 'react';

interface MojoLogoIconProps {
  className?: string;
  fontSize?: number;
  style?: CSSProperties;
}

/**
 * MOJO logo as a drop-in replacement for AFFiNE's Logo1Icon.
 * Renders the brand mark from /imgs/mojo-logo.png.
 */
export const MojoLogoIcon = ({
  className,
  fontSize = 20,
  style,
}: MojoLogoIconProps) => {
  return (
    <img
      src="/imgs/mojo-logo.png"
      alt="MOJO Notion"
      className={className}
      width={fontSize}
      height={fontSize}
      style={{
        objectFit: 'contain',
        verticalAlign: 'middle',
        display: 'inline-block',
        ...style,
      }}
    />
  );
};
