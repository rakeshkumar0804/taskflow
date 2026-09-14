import React from 'react';

const CATEGORY_STYLES = {
  project: { bg: 'rgba(99, 102, 241, 0.15)', text: '#818cf8', border: 'rgba(99, 102, 241, 0.3)' },
  task: { bg: 'rgba(59, 130, 246, 0.15)', text: '#60a5fa', border: 'rgba(59, 130, 246, 0.3)' },
  dependency: { bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.3)' },
  blocker: { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171', border: 'rgba(239, 68, 68, 0.3)' },
  release: { bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399', border: 'rgba(16, 185, 129, 0.3)' },
  milestone: { bg: 'rgba(6, 182, 212, 0.15)', text: '#22d3ee', border: 'rgba(6, 182, 212, 0.3)' },
  decision: { bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.3)' },
  capacity: { bg: 'rgba(244, 63, 94, 0.15)', text: '#fb7185', border: 'rgba(244, 63, 94, 0.3)' },
};

export function CategoryBadge({ category }) {
  const cat = (category || 'task').toLowerCase();
  const style = CATEGORY_STYLES[cat] || { bg: 'rgba(255, 255, 255, 0.1)', text: '#e2e8f0', border: 'rgba(255, 255, 255, 0.2)' };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '11px',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        backgroundColor: style.bg,
        color: style.text,
        border: `1px solid ${style.border}`,
      }}
    >
      {cat}
    </span>
  );
}

export function VersionBadge({ version }) {
  if (version === undefined || version === null) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: '700',
        fontFamily: 'monospace',
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        color: '#94a3b8',
        border: '1px solid rgba(255, 255, 255, 0.15)',
      }}
      title={`Aggregate Activity Version: v${version}`}
    >
      v{version}
    </span>
  );
}

export function RoleBadge({ role }) {
  const r = (role || 'member').toLowerCase();
  const isAdm = r === 'admin';
  const isMgr = r === 'manager';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 6px',
        borderRadius: '4px',
        fontSize: '10px',
        fontWeight: '600',
        textTransform: 'capitalize',
        backgroundColor: isAdm ? 'rgba(239, 68, 68, 0.2)' : isMgr ? 'rgba(59, 130, 246, 0.2)' : 'rgba(148, 163, 184, 0.2)',
        color: isAdm ? '#fca5a5' : isMgr ? '#93c5fd' : '#cbd5e1',
      }}
    >
      {r}
    </span>
  );
}
