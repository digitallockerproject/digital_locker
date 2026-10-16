import React from 'react';
import Icon from './Icon.jsx';

export default function Status({ value }) {
  const style = { Clean: ['green', 'check'], Flagged: ['red', 'alert'], Quarantined: ['amber', 'clock'], Scanning: ['blue', 'clock'], Active: ['green', 'link'], Expired: ['muted', 'clock'], Revoked: ['muted', 'close'] }[value] || ['muted', 'info'];
  return <span className={`status ${style[0]}`}><Icon name={style[1]} size={13} />{value}</span>;
}
