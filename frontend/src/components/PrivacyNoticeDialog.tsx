type PrivacyNoticeDialogProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function PrivacyNoticeDialog({ isOpen, onClose }: PrivacyNoticeDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="auth-dialog-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="privacy-dialog" role="dialog" aria-modal="true" aria-label="Privacy notice">
        <div className="auth-dialog-header privacy-dialog-header">
          <div>
            <h2 className="auth-dialog-title">Privacy Notice</h2>
            <p className="auth-dialog-subtitle">
              Last updated March 9, 2026. This notice describes how GraphCalc handles guest workspaces, accounts, sessions, and technical operations.
            </p>
          </div>
          <button className="auth-close" type="button" onClick={onClose} aria-label="Close privacy notice">
            ×
          </button>
        </div>

        <div className="privacy-dialog-body">
          <section className="privacy-section">
            <h3>Scope</h3>
            <p>
              This notice applies to everyone using this service. It covers both anonymous guest usage and optional account-based usage.
            </p>
          </section>

          <section className="privacy-section">
            <h3>Account Model</h3>
            <ul>
              <li>Accounts are optional. The calculator can be used without signing in.</li>
              <li>Guest workspaces are stored locally in your browser on your device.</li>
              <li>Account workspaces are stored on the server and are tied to the account you sign in with.</li>
              <li>We only ask for a username and password for account creation and sign-in.</li>
            </ul>
          </section>

          <section className="privacy-section">
            <h3>Guest Storage</h3>
            <p>
              When you use the app without an account, your projects, graphs, recipes, tags, and related configuration are kept in browser local storage.
              That data stays on the device and browser profile you are using unless you clear it, switch browsers, or explicitly merge it into an account.
            </p>
          </section>

          <section className="privacy-section">
            <h3>Session Management</h3>
            <p>
              Signed-in sessions use a secure HTTP-only session cookie. The cookie is used only to keep you signed in and authorize requests to your account data.
              It is not intended for analytics, advertising, or cross-site tracking.
            </p>
          </section>

          <section className="privacy-section">
            <h3>Data We Process</h3>
            <ul>
              <li>Username for account identification.</li>
              <li>Password in hashed form only. Passwords are not stored in plain text.</li>
              <li>User-created workspace content such as projects, graphs, recipes, tags, item definitions, and solver configuration.</li>
              <li>Technical request data needed to operate the service, including request paths, response status, origin header values, trace identifiers, and request duration.</li>
            </ul>
          </section>

          <section className="privacy-section">
            <h3>What We Do Not Use Your Data For</h3>
            <ul>
              <li>No advertising profiles.</li>
              <li>No telemetry or analytics SDKs in the frontend.</li>
              <li>No sale of account or workspace data.</li>
            </ul>
          </section>

          <section className="privacy-section">
            <h3>Security</h3>
            <div className="privacy-callout info">
              Transport is protected over HTTPS, account passwords are hashed, and authenticated requests are validated server-side before account-scoped data is accessed.
            </div>
            <ul>
              <li>Passwords are stored only as derived hashes with salt and configured iteration cost.</li>
              <li>Database access is restricted to the configured backend service.</li>
              <li>Session tokens are validated on each authenticated request.</li>
              <li>Rate limits are applied to authentication, CRUD, and solve endpoints, including separate limits for guest solves.</li>
            </ul>
          </section>

          <section className="privacy-section">
            <h3>Backups and Retention</h3>
            <div className="privacy-callout warning">
              No backup or recovery guarantee is provided for guest data or account data. Data may be lost because of browser clearing, breaking changes, server issues, or manual deletion.
            </div>
            <p>
              You should treat this as a convenience tool, not as a guaranteed archival system.
            </p>
          </section>

          <section className="privacy-section">
            <h3>Important Use Restriction</h3>
            <p>
              Do not store personal, confidential, or regulated information in usernames, projects, graphs, recipes, notes, or any other user-defined content.
              This service is intended for non-personal calculation and configuration data only.
            </p>
          </section>

          <section className="privacy-section">
            <h3>Administrative Access</h3>
            <p>
              Operators with infrastructure or database access may be able to access server-stored account data when needed for maintenance, debugging, abuse handling, or security response.
            </p>
          </section>

          <section className="privacy-section">
            <h3>Disclaimer</h3>
            <ul>
              <li>No guarantee of uptime or uninterrupted availability.</li>
              <li>No guarantee of persistence, backup, or recovery.</li>
              <li>No guarantee that calculations are always correct, complete, or fit for a particular purpose.</li>
              <li>Use of the service is at your own risk.</li>
            </ul>
          </section>

          <section className="privacy-section">
            <h3>Changes</h3>
            <p>
              This notice may be updated as the project changes. Continued use after an update means the revised notice applies from that point onward.
            </p>
          </section>
        </div>

        <div className="auth-actions">
          <button className="primary" type="button" onClick={onClose}>
            Close Notice
          </button>
        </div>
      </div>
    </div>
  );
}