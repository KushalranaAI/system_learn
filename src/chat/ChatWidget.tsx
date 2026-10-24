import { ArrowUp, Eraser, KeyRound, MessageCircle, Sparkles, Square, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useLocation } from "react-router-dom";
import { providerLabel, useAi, useAiActive } from "../ai/settings";
import { useWorkspace } from "../state/workspace";
import { chatSources, onSourcesChange, useChat } from "./store";

const FALLBACK_SUGGESTIONS = ["What can I do on this page?", "Explain system design in one paragraph", "What should I learn next?"];

function useSources() {
  // re-render when a screen registers or leaves; the list itself is rebuilt on every render so labels stay fresh
  useSyncExternalStore(onSourcesChange, () => chatSources().length);
  return chatSources();
}

function Message({ role, content, error }: { role: "user" | "assistant"; content: string; error?: boolean }) {
  if (role === "user") return <div className="chat-msg user"><p>{content}</p></div>;
  if (error) return <div className="chat-msg error"><p>{content}</p></div>;
  return (
    <div className="chat-msg assistant">
      {content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown> : <span className="typing"><i /><i /><i /></span>}
    </div>
  );
}

/** A floating assistant that knows what is on the learner's screen. Opens from the button at the bottom right. */
export function ChatWidget() {
  const { open, busy, messages } = useChat();
  const { setOpen, send, stop, clear } = useChat.getState();
  const presenter = useWorkspace((s) => s.presenter);
  const active = useAiActive();
  const provider = useAi((s) => s.settings.provider);
  const route = useLocation().pathname;
  const sources = useSources();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);
  useEffect(() => {
    if (open && active) inputRef.current?.focus();
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (presenter) return null;

  const suggestions = sources.flatMap((s) => s.suggestions ?? []).slice(0, 4);
  const submit = (text = draft) => {
    if (!text.trim() || busy) return;
    setDraft("");
    void send(text, route);
  };

  return (
    <>
      {open && (
        <section className="chat" role="dialog" aria-label="Ask the tutor">
          <header className="chat-head">
            <span className="chat-avatar"><Sparkles size={15} /></span>
            <div className="grow">
              <b>Ask the tutor</b>
              <span className="chat-sees" title={sources.map((s) => s.label).join("\n")}>
                {sources.length ? `Sees: ${sources.map((s) => s.label).join(" · ")}` : "Sees: this page"}
              </span>
            </div>
            {messages.length > 0 && <button className="icon-btn sm" onClick={clear} title="Start a new chat" aria-label="New chat"><Eraser size={15} /></button>}
            <button className="icon-btn sm" onClick={() => setOpen(false)} title="Close (Esc)" aria-label="Close chat"><X size={16} /></button>
          </header>

          {!active ? (
            <div className="chat-empty">
              <span className="empty-icon"><KeyRound size={20} /></span>
              <b>Connect an AI key to chat</b>
              <p>Add your OpenAI or Anthropic key. The tutor then answers questions about whatever you have open, using your own numbers.</p>
              <Link className="btn primary" to="/ai" onClick={() => setOpen(false)}>Add an AI key</Link>
              <span className="hint">Your key stays in this browser.</span>
            </div>
          ) : (
            <>
              <div className="chat-body">
                {messages.length === 0 ? (
                  <div className="chat-intro">
                    <p>Ask anything about what's on your screen: your design, a simulation result, a lesson or a lab step.</p>
                    <div className="chat-suggestions">
                      {(suggestions.length ? suggestions : FALLBACK_SUGGESTIONS).map((q) => (
                        <button key={q} onClick={() => submit(q)}>{q}</button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((m, i) => <Message key={i} {...m} />)
                )}
                <div ref={endRef} />
              </div>
              <form className="chat-input" onSubmit={(e) => (e.preventDefault(), submit())}>
                <textarea
                  ref={inputRef}
                  value={draft}
                  rows={1}
                  placeholder="Ask about this screen…"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                {busy ? (
                  <button type="button" className="chat-send stop" onClick={stop} title="Stop" aria-label="Stop"><Square size={14} fill="currentColor" /></button>
                ) : (
                  <button type="submit" className="chat-send" disabled={!draft.trim()} title="Send (Enter)" aria-label="Send"><ArrowUp size={17} /></button>
                )}
              </form>
              <p className="chat-foot">{providerLabel(provider)} · AI can be wrong. Each message sends what's on screen to your provider.</p>
            </>
          )}
        </section>
      )}
      <button className={`chat-fab${open ? " open" : ""}`} onClick={() => setOpen(!open)} aria-label={open ? "Close chat" : "Ask the tutor"} title={open ? "Close chat" : "Ask the tutor"}>
        {open ? <X size={22} /> : <MessageCircle size={22} />}
        {!open && <span className="chat-fab-label">Ask AI</span>}
      </button>
    </>
  );
}
