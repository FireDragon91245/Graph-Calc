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
  onPasswordChange: (currentPassword: string, newPassword: string) => Promise<void>;
  onDeleteAccount: (currentPassword: string) => Promise<void>;
  onLogout: () => Promise<void>;
};

export default function AuthDialog({
  isOpen,
  initialMode,
  currentUser,
  onClose,
  onLogin,
  onRegister,
  onPasswordChange,
  onDeleteAccount,
  onLogout,
}: AuthDialogProps) {
  const [mode, setMode] = useState<AuthDialogMode>(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setMode(initialMode);
    setUsername("");
    setPassword("");
    setCurrentPassword("");
    setNewPassword("");
    setDeletePassword("");
    setError(null);
    setSuccessMessage(null);
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
    setSuccessMessage(null);

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
    setSuccessMessage(null);

    try {
      await onLogout();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Logout failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (newPassword.length <= 8) {
      setError("Password must be longer than 8 characters.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await onPasswordChange(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setSuccessMessage("Password updated.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Password change failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!deletePassword) {
      setError("Current password is required to delete the account.");
      return;
    }

    if (!confirm("Delete this account and all of its projects? This cannot be undone.")) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await onDeleteAccount(deletePassword);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Account deletion failed.");
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
              {currentUser
                ? "You are signed in and your workspace is synced to your account."
                : "Guest work stays in this browser until you sign in or create an account."}
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
              <div>Projects: {currentUser.projectCount}</div>
              <div>Active project: {currentUser.activeProjectId ?? "none"}</div>
              <div>Logout copies the current account workspace back into local browser storage.</div>
            </div>
            <form className="auth-form auth-settings-form" onSubmit={handlePasswordChange}>
              <div className="auth-section-title">Change Password</div>
              <div className="auth-field">
                <label htmlFor="auth-current-password">Current password</label>
                <input
                  id="auth-current-password"
                  className="auth-input"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={isSubmitting}
                />
              </div>
              <div className="auth-field">
                <label htmlFor="auth-new-password">New password</label>
                <input
                  id="auth-new-password"
                  className="auth-input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  disabled={isSubmitting}
                />
              </div>
              <p className="auth-helper">Changing the password rotates the session version and invalidates older JWTs.</p>
              <div className="auth-actions auth-inline-actions">
                <button className="auth-secondary" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Change Password"}
                </button>
              </div>
            </form>

            <form className="auth-form auth-settings-form auth-danger-zone" onSubmit={handleDeleteAccount}>
              <div className="auth-section-title">Delete Account</div>
              <div className="auth-field">
                <label htmlFor="auth-delete-password">Current password</label>
                <input
                  id="auth-delete-password"
                  className="auth-input"
                  type="password"
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={isSubmitting}
                />
              </div>
              <p className="auth-helper">This removes the user and all user-owned projects, graphs, and store data.</p>
              <div className="auth-actions auth-inline-actions">
                <button className="auth-danger" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Deleting..." : "Delete Account"}
                </button>
              </div>
            </form>

            {error && <p className="auth-error">{error}</p>}
            {successMessage && <p className="auth-success">{successMessage}</p>}
            <div className="auth-actions">
              <button className="auth-secondary" type="button" onClick={onClose} disabled={isSubmitting}>
                Close
              </button>
              <button className="primary" type="button" onClick={handleLogout} disabled={isSubmitting}>
                {isSubmitting ? "Logging out..." : "Logout"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="auth-helper" style={{ marginBottom: 16 }}>
              Login opens the existing account workspace and will ask for merge decisions if guest and account data differ. Register creates a new account and imports your current guest projects, graphs, and store data immediately.
            </div>
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
                <button className="auth-secondary" type="button" onClick={onClose} disabled={isSubmitting}>
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