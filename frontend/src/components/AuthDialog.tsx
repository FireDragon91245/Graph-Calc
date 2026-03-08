import { FormEvent, useEffect, useState } from "react";
import type { AuthUser } from "../api/auth";

export type AuthDialogMode = "login" | "register";

type AuthDialogProps = {
  isOpen: boolean;
  initialMode: AuthDialogMode;
  currentUser: AuthUser | null;
  onClose: () => void;
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string) => Promise<void>;
  onLogout: () => Promise<void>;
};

export default function AuthDialog({
  isOpen,
  initialMode,
  currentUser,
  onClose,
  onLogin,
  onRegister,
  onLogout,
}: AuthDialogProps) {
  const [mode, setMode] = useState<AuthDialogMode>(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setMode(initialMode);
    setUsername("");
    setPassword("");
    setError(null);
    setIsSubmitting(false);
  }, [initialMode, isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUsername = username.trim();

    if (!trimmedUsername) {
      setError("Username is required.");
      return;
    }

    if (mode === "register" && password.length <= 8) {
      setError("Password must be longer than 8 characters.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (mode === "login") {
        await onLogin(trimmedUsername, password);
      } else {
        await onRegister(trimmedUsername, password);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      await onLogout();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Logout failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-dialog-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="auth-dialog" role="dialog" aria-modal="true" aria-label="Authentication dialog">
        <div className="auth-dialog-header">
          <div>
            <h2 className="auth-dialog-title">Account</h2>
            <p className="auth-dialog-subtitle">
              {currentUser ? "You are signed in for this browser session." : "Use a username and password to create or resume a session."}
            </p>
          </div>
          <button className="auth-close" type="button" onClick={onClose} aria-label="Close authentication dialog">
            ×
          </button>
        </div>

        {currentUser ? (
          <div className="auth-session-card">
            <div>
              <strong>{currentUser.username}</strong>
            </div>
            <div className="auth-session-meta">
              <div>Logged in with a secure session cookie.</div>
              <div>User ID: {currentUser.id}</div>
            </div>
            {error && <p className="auth-error">{error}</p>}
            <div className="auth-actions">
              <button className="secondary" type="button" onClick={onClose} disabled={isSubmitting}>
                Close
              </button>
              <button className="primary" type="button" onClick={handleLogout} disabled={isSubmitting}>
                {isSubmitting ? "Logging out..." : "Logout"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="auth-tabs">
              <button
                className={`auth-tab${mode === "login" ? " active" : ""}`}
                type="button"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                Login
              </button>
              <button
                className={`auth-tab${mode === "register" ? " active" : ""}`}
                type="button"
                onClick={() => {
                  setMode("register");
                  setError(null);
                }}
              >
                Register
              </button>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="auth-field">
                <label htmlFor="auth-username">Username</label>
                <input
                  id="auth-username"
                  className="auth-input"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  disabled={isSubmitting}
                />
              </div>

              <div className="auth-field">
                <label htmlFor="auth-password">Password</label>
                <input
                  id="auth-password"
                  className="auth-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  disabled={isSubmitting}
                />
              </div>

              {mode === "register" && <p className="auth-helper">Password rule: longer than 8 characters.</p>}
              {error && <p className="auth-error">{error}</p>}

              <div className="auth-actions">
                <button className="secondary" type="button" onClick={onClose} disabled={isSubmitting}>
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (mode === "login" ? "Logging in..." : "Registering...") : (mode === "login" ? "Login" : "Register")}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}