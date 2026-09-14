import React, { useMemo } from 'react';
import { CategoryBadge, VersionBadge, RoleBadge } from './ActivityBadge';
import './ActivityTimeline.css';

// Clean, local SVG icons (zero external dependencies)
const CategoryIcons = {
  project: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  task: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  dependency: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="12" r="3" />
      <line x1="8.5" y1="7.5" x2="15.5" y2="10.5" />
      <line x1="8.5" y1="16.5" x2="15.5" y2="13.5" />
    </svg>
  ),
  blocker: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  ),
  release: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-3.05 11a22.35 22.35 0 0 1-3.95 2z" />
    </svg>
  ),
  milestone: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  ),
  decision: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v3" />
      <path d="m19 14 3 3-3 3" />
      <path d="M5 14l-3 3 3 3" />
      <circle cx="12" cy="14" r="5" />
    </svg>
  ),
  capacity: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fb7185" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
};

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 45) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getDayGroup(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const oneWeekAgo = new Date(today);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  if (d >= today) return 'Today';
  if (d >= yesterday) return 'Yesterday';
  if (d >= oneWeekAgo) return 'This Week';
  return 'Earlier';
}

export default function ActivityTimeline({ events, onSelectEvent }) {
  const groupedEvents = useMemo(() => {
    if (!events || events.length === 0) return [];

    const groupsMap = {
      Today: [],
      Yesterday: [],
      'This Week': [],
      Earlier: [],
    };

    events.forEach((ev) => {
      const grp = getDayGroup(ev.occurredAt || ev.createdAt);
      if (groupsMap[grp]) {
        groupsMap[grp].push(ev);
      } else {
        groupsMap.Earlier.push(ev);
      }
    });

    return Object.entries(groupsMap).filter(([, items]) => items.length > 0);
  }, [events]);

  if (!events || events.length === 0) {
    return (
      <div className="activity-empty-state">
        <h4>No activity events found</h4>
        <p>No lifecycle mutations match the current filters or query scope.</p>
      </div>
    );
  }

  return (
    <div className="activity-timeline">
      {groupedEvents.map(([groupName, items]) => (
        <div key={groupName} className="activity-group">
          <h3 className="activity-group-title">{groupName}</h3>
          <div className="activity-items-list">
            {items.map((ev) => {
              const cat = (ev.category || 'task').toLowerCase();
              const IconComp = CategoryIcons[cat] || CategoryIcons.task;
              const actorName = ev.actorSnapshot?.name || ev.actor?.name || 'System';
              const actorRole = ev.actorSnapshot?.role || ev.actor?.role || 'user';
              const primaryDiff = ev.changes && ev.changes.length > 0 ? ev.changes[0] : null;

              return (
                <div
                  key={ev._id || ev.correlationId}
                  className="activity-card"
                  onClick={() => onSelectEvent(ev)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectEvent(ev);
                    }
                  }}
                >
                  <div
                    className="activity-card-icon-wrap"
                    style={{
                      backgroundColor:
                        cat === 'project'
                          ? 'rgba(99, 102, 241, 0.12)'
                          : cat === 'task'
                          ? 'rgba(59, 130, 246, 0.12)'
                          : cat === 'blocker'
                          ? 'rgba(239, 68, 68, 0.12)'
                          : cat === 'release'
                          ? 'rgba(16, 185, 129, 0.12)'
                          : cat === 'milestone'
                          ? 'rgba(6, 182, 212, 0.12)'
                          : cat === 'decision'
                          ? 'rgba(245, 158, 11, 0.12)'
                          : cat === 'capacity'
                          ? 'rgba(244, 63, 94, 0.12)'
                          : 'rgba(168, 85, 247, 0.12)',
                    }}
                  >
                    <IconComp />
                  </div>

                  <div className="activity-card-content">
                    <div className="activity-card-header">
                      <div className="activity-card-badges">
                        <CategoryBadge category={ev.category} />
                        <VersionBadge version={ev.aggregateVersion} />
                        {ev.subjectTitleSnapshot && (
                          <span className="activity-card-subject">
                            {ev.subjectTitleSnapshot}
                          </span>
                        )}
                      </div>
                      <span className="activity-card-time" title={new Date(ev.occurredAt || ev.createdAt).toLocaleString()}>
                        {formatRelativeTime(ev.occurredAt || ev.createdAt)}
                      </span>
                    </div>

                    <p className="activity-card-summary">
                      {ev.summary || ev.eventType}
                    </p>

                    <div className="activity-card-meta-row">
                      <span className="activity-card-actor">
                        <strong>{actorName}</strong>
                        <RoleBadge role={actorRole} />
                      </span>

                      {primaryDiff && (
                        <span className="activity-diff-chip" title={`${primaryDiff.field}: ${primaryDiff.from} -> ${primaryDiff.to}`}>
                          <span>{primaryDiff.field}:</span>
                          <span className="from">{String(primaryDiff.from ?? 'none')}</span>
                          <span className="arrow">→</span>
                          <span className="to">{String(primaryDiff.to ?? 'none')}</span>
                        </span>
                      )}

                      {ev.correlationId && (
                        <span className="activity-correlation-tag" title={`Correlation ID: ${ev.correlationId}`}>
                          id:{ev.correlationId.slice(0, 8)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
