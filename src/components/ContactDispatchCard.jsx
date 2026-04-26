import { useId, useState } from "react";
import "./ContactDispatchCard.css";

export default function ContactDispatchCard({
  previewState = "default",
  className = "",
  alias = "",
  pingAddress = "",
  payload = "",
}) {
  const idPrefix = useId();
  const [focusedField, setFocusedField] = useState(previewState === "active" ? "payload" : "");

  const isHoverPreview = previewState === "hover";

  function fieldClass(fieldName) {
    const isFocused = focusedField === fieldName;
    return [
      "cipher-input",
      isFocused ? "cipher-input-focused" : "",
      previewState === "active" && fieldName === "payload" ? "cipher-input-focused" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return (
    <section className={`cipher-dispatch-card ${isHoverPreview ? "cipher-dispatch-hover" : ""} ${className}`.trim()}>
      <div className="cipher-status-row" aria-hidden="true">
        <span className="cipher-status-dot" />
        <span className="cipher-status-text">SYSTEM SECURE</span>
      </div>

      <header className="cipher-header">
        <h2 className="cipher-title">&gt; CIPHER_DISPATCH_PROTOCOL</h2>
        <p className="cipher-subtitle">Secure transmission channel established. Awaiting payload.</p>
      </header>

      <form className="cipher-form" onSubmit={(e) => e.preventDefault()}>
        <label className="cipher-label" htmlFor={`${idPrefix}-alias`}>
          [ALIAS / USER_ID]
        </label>
        <input
          id={`${idPrefix}-alias`}
          type="text"
          className={fieldClass("alias")}
          value={alias}
          onFocus={() => setFocusedField("alias")}
          onBlur={() => setFocusedField("")}
          placeholder=""
          autoComplete="off"
          readOnly={previewState !== "active"}
        />

        <label className="cipher-label" htmlFor={`${idPrefix}-ping`}>
          [RETURN_PING_ADDRESS]
        </label>
        <input
          id={`${idPrefix}-ping`}
          type="email"
          className={fieldClass("ping")}
          value={pingAddress}
          onFocus={() => setFocusedField("ping")}
          onBlur={() => setFocusedField("")}
          placeholder=""
          autoComplete="off"
          readOnly={previewState !== "active"}
        />

        <label className="cipher-label" htmlFor={`${idPrefix}-payload`}>
          [TRANSMISSION_PAYLOAD]
        </label>
        <textarea
          id={`${idPrefix}-payload`}
          className={`${fieldClass("payload")} cipher-textarea`.trim()}
          value={payload}
          onFocus={() => setFocusedField("payload")}
          onBlur={() => setFocusedField("")}
          placeholder=""
          readOnly={previewState !== "active"}
        />

        <button type="submit" className={`cipher-dispatch-button ${isHoverPreview ? "cipher-dispatch-button-hover" : ""}`.trim()}>
          [ EXECUTE DISPATCH ]
        </button>
      </form>
    </section>
  );
}
