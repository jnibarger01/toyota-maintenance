/** Loading / Empty / Error building blocks used by every step. */
import { CircleAlert, FileQuestion, LoaderCircle } from "lucide-react";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <LoaderCircle className="spinner" size={24} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="state state-empty">
      <FileQuestion className="state-icon" size={28} aria-hidden="true" />
      <p className="state-title">{title}</p>
      {hint ? <p className="state-hint">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <CircleAlert className="state-icon" size={28} aria-hidden="true" />
      <p className="state-title">Something went wrong</p>
      <p className="state-hint">{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>Try again</button>
      ) : null}
    </div>
  );
}
