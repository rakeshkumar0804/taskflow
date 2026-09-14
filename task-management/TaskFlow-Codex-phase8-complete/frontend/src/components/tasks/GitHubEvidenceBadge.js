import React from 'react';

const LABELS = {
  in_review: 'PR in review',
  changes_requested: 'Changes requested',
  ci_failed: 'CI failed',
  ready: 'CI passed',
  verified: 'Merged · verified',
};

export default function GitHubEvidenceBadge({ task }) {
  const evidence = task?.githubEvidence;
  if (!evidence) return null;
  const label = LABELS[task.verificationStatus] || 'GitHub linked';
  return (
    <a
      className={`github-evidence-badge github-evidence-${task.verificationStatus || 'in_review'}`}
      href={evidence.pullRequestUrl}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      title={`${evidence.repository}#${evidence.pullRequestNumber}`}
    >
      <span aria-hidden="true">↗</span> {label}
    </a>
  );
}
