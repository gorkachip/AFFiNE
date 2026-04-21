import { Container, Row, Section } from '@react-email/components';
import type { CSSProperties } from 'react';

import { BasicTextStyle } from './common';

const TextStyles: CSSProperties = {
  ...BasicTextStyle,
  color: '#8e8d91',
  marginTop: '8px',
};

export const Footer = () => {
  return (
    <Container
      style={{
        backgroundColor: '#fafafa',
        maxWidth: '450px',
        marginTop: '0',
        marginBottom: '32px',
        borderRadius: '0 0 16px 16px',
        boxShadow: '0px 0px 20px 0px rgba(66, 65, 73, 0.04)',
        padding: '24px',
      }}
    >
      <Section align="center" width="auto">
        <Row style={TextStyles}>
          <td>Paradise. Before the world arrives.</td>
        </Row>
      </Section>
      <Section align="center" width="auto">
        <Row style={TextStyles}>
          <td>© {new Date().getUTCFullYear()} MOJO Developments</td>
        </Row>
      </Section>
    </Container>
  );
};
