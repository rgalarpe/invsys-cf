export const CURRENCY = '$';

export const money = (cents) =>
  `${CURRENCY}${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// DB timestamps are UTC text like "2026-11-22 08:30:00"
const parse = (s) => new Date(s.replace(' ', 'T') + 'Z');

export function shortDate(s) {
  if (!s) return '';
  return parse(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function shortDateTime(s) {
  if (!s) return '';
  return parse(s).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}