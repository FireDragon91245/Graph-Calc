import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PrivacyNoticeDialog from "./PrivacyNoticeDialog";

export type AuthDialogMode = "login" | "register";

type AuthDialogProps = {
  isOpen: boolean;
  initialMode: AuthDialogMode;
  onClose: () => void;
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string) => Promise<void>;
};

export default function AuthDialog({ isOpen, initialMode, onClose, onLogin, onRegister }: AuthDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AuthDialogMode>(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPrivacyNoticeOpen, setIsPrivacyNoticeOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode);
    setUsername("");
    setPassword("");
    setError(null);
    setIsSubmitting(false);
    setIsPrivacyNoticeOpen(false);
  }, [initialMode, isOpen]);

  if (!isOpen) return null;

  const selectMode = (nextMode: AuthDialogMode) => {
    setMode(nextMode);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUsername = username.trim();

    if (!trimmedUsername) {
      setError(t("errors.usernameRequired"));
      return;
    }

    if (mode === "register" && password.length <= 8) {
      setError(t("errors.passwordTooShort"));
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await (mode === "login" ? onLogin(trimmedUsername, password) : onRegister(trimmedUsername, password));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("errors.authenticationFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-dialog-backdrop" onClick={(event) => event.target === event.currentTarget && !isSubmitting && onClose()}>
      <div className="auth-dialog" role="dialog" aria-modal="true" aria-label={t("auth.title")}>
        <div className="auth-dialog-header">
          <div>
            <h2 className="auth-dialog-title">{mode === "login" ? t("auth.title") : t("auth.registerTitle")}</h2>
            <p className="auth-dialog-subtitle">{mode === "login" ? t("auth.loginDescription") : t("auth.registerDescription")}</p>
          </div>
          <button className="auth-close" type="button" onClick={onClose} disabled={isSubmitting} aria-label={t("auth.closeLabel")}>×</button>
        </div>

        <div className="auth-tabs" role="tablist">
          <button className={`auth-tab${mode === "login" ? " active" : ""}`} type="button" role="tab" aria-selected={mode === "login"} onClick={() => selectMode("login")}>{t("auth.login")}</button>
          <button className={`auth-tab${mode === "register" ? " active" : ""}`} type="button" role="tab" aria-selected={mode === "register"} onClick={() => selectMode("register")}>{t("auth.register")}</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label htmlFor="auth-username">{t("common.fields.username")}</label>
            <input id="auth-username" className="auth-input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" disabled={isSubmitting} autoFocus />
          </div>
          <div className="auth-field">
            <label htmlFor="auth-password">{t("common.fields.password")}</label>
            <input id="auth-password" className="auth-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} disabled={isSubmitting} />
          </div>
          {mode === "register" && <p className="auth-helper">{t("auth.passwordRule")}</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <div className="auth-actions">
            <button className="auth-secondary" type="button" onClick={onClose} disabled={isSubmitting}>{t("common.actions.cancel")}</button>
            <button className="primary" type="submit" disabled={isSubmitting}>{isSubmitting ? (mode === "login" ? t("auth.loggingIn") : t("auth.registering")) : (mode === "login" ? t("auth.login") : t("auth.register"))}</button>
          </div>
        </form>

        <div className="auth-legal-link-row">
          <button className="auth-legal-link" type="button" onClick={() => setIsPrivacyNoticeOpen(true)}>{t("auth.privacyNotice")}</button>
        </div>
        <PrivacyNoticeDialog isOpen={isPrivacyNoticeOpen} onClose={() => setIsPrivacyNoticeOpen(false)} />
      </div>
    </div>
  );
}
