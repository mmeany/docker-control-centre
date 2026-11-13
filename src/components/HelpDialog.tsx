// The help dialog, and the two ways a view or dialog says which topic applies.
import { useEffect, useRef, useState } from "react";
import { HELP_TOPICS, type HelpTopicId } from "../help";
import { closeHelp, openHelp, registerHelpTopic } from "../help/store";
import { HelpIcon } from "./Icons";
import { Markdown } from "./Markdown";

/** Marks the topic of whatever is on screen (a tab inside a view). Renders nothing. */
export function HelpTopic({ id }: { id: HelpTopicId }) {
  useEffect(() => registerHelpTopic(id), [id]);
  return null;
}

/** Help button for a dialog's title bar; F1 shows the same topic while it's open. */
export function DialogHelp({ topic }: { topic: HelpTopicId }) {
  useEffect(() => registerHelpTopic(topic), [topic]);
  return (
    <button type="button" className="tool-btn dialog-help" title="Help for this dialog (F1)" aria-label="Help" onClick={() => openHelp(topic)}>
      <HelpIcon />
    </button>
  );
}

/** The help button for a layout's toolbar or header. */
export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="tool-btn help-btn" title="Help for this view (F1)" aria-label="Help for this view" onClick={onClick}>
      <HelpIcon />
    </button>
  );
}

export function HelpDialog({ topic, general }: { topic: HelpTopicId; general: HelpTopicId }) {
  // Where General help came from, so it can go back.
  const [from, setFrom] = useState<HelpTopicId | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Take focus, and hand it back so Esc still works in a dialog underneath.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [topic]);

  const text = HELP_TOPICS[topic];
  return (
    <div className="modal-backdrop help-backdrop" onMouseDown={closeHelp}>
      <div
        className="dialog help-dialog"
        role="dialog"
        aria-modal
        aria-labelledby="help-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            closeHelp();
          }
        }}
      >
        <div className="dialog-title" id="help-title">
          Help: {text.title}
        </div>
        <div className="help-body" ref={bodyRef} tabIndex={-1}>
          <Markdown text={text.body} />
        </div>
        <div className="dialog-buttons">
          {from ? (
            <button
              className="btn"
              onClick={() => {
                openHelp(from);
                setFrom(null);
              }}
            >
              Back to {HELP_TOPICS[from].title}
            </button>
          ) : (
            topic !== general && (
              <button
                className="btn"
                onClick={() => {
                  setFrom(topic);
                  openHelp(general);
                }}
              >
                General help
              </button>
            )
          )}
          <div className="spacer" />
          <button ref={closeRef} className="btn primary" onClick={closeHelp}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
