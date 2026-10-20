import React from 'react';
import logo from '../assets/greatstone-logo-web.png';

// The website supplies its published legal pages when this module is mounted there.
// The stand-alone site follows the public footer: draft legal pages are not linked.
export default function GreatstoneFooter({ legalLinks = [] }) {
  return <footer className="greatstone-footer">
    <a href="https://greatstoneint.com/" aria-label="Greatstone International home">
      <img src={logo} alt="Greatstone International" width="160" height="32" loading="lazy" />
    </a>
    <p>The Foundation of Digital Excellence</p>
    <a href="mailto:dx@greatstonesoftware.co.uk">dx@greatstonesoftware.co.uk</a>
    {legalLinks.length > 0 && <nav aria-label="Legal">{legalLinks.map(({ href, label }) => <a key={href} href={href}>{label}</a>)}</nav>}
    <small>© {new Date().getFullYear()} Greatstone International Ltd. All rights reserved.</small>
  </footer>;
}
