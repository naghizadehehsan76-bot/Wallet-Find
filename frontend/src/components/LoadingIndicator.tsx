import type { CSSProperties } from "react";

type LoadingIndicatorProps = {
  label?: string;
  compact?: boolean;
};

export default function LoadingIndicator({ label, compact = false }: LoadingIndicatorProps) {
  return (
    <span className={`wf-loading${compact ? " wf-loading--compact" : ""}`} role="status" aria-live="polite">
      <span className="wf-loading__mark" aria-hidden="true">
        <span className="wf-loading__orbit" />
        <span className="wf-loading__core"><span>W</span></span>
      </span>
      {label ? <span className="wf-loading__label">{label}</span> : null}
    </span>
  );
}
