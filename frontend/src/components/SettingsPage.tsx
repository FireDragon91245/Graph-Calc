import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuthUser } from "../api/auth";
import { getCurrentLanguage, type SupportedLanguage } from "../i18n";
import type { AuthDialogMode } from "./AuthDialog";
import PrivacyNoticeDialog from "./PrivacyNoticeDialog";
import EntityThumbnail from "./EntityThumbnail";

type SettingsPageProps = {
  currentUser: AuthUser | null;
  profileImageUrl: string | null;
  onBack: () => void;
  onOpenAuth: (mode: AuthDialogMode) => void;
  onPasswordChange: (currentPassword: string, newPassword: string) => Promise<void>;
  onDeleteAccount: (currentPassword: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onProfileImageUpload: (file: File) => Promise<void>;
  onProfileImageDelete: () => Promise<void>;
  onLanguageChange: (language: SupportedLanguage) => Promise<void>;
};

export default function SettingsPage({ currentUser, profileImageUrl, onBack, onOpenAuth, onPasswordChange, onDeleteAccount, onLogout, onProfileImageUpload, onProfileImageDelete, onLanguageChange }: SettingsPageProps) {
  const { t, i18n } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordState, setPasswordState] = useState<{ busy: boolean; error: string | null; success: string | null }>({ busy: false, error: null, success: null });
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteState, setDeleteState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [isRemovingImage, setIsRemovingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isSavingLanguage, setIsSavingLanguage] = useState(false);
  const [languageError, setLanguageError] = useState<string | null>(null);

  const changeLanguage = async (language: SupportedLanguage) => {
    setIsSavingLanguage(true);
    setLanguageError(null);
    try {
      await onLanguageChange(language);
    } catch (error) {
      setLanguageError(error instanceof Error ? error.message : t("settings.general.saveFailed"));
    } finally {
      setIsSavingLanguage(false);
    }
  };

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length <= 8) {
      setPasswordState({ busy: false, error: t("errors.passwordTooShort"), success: null });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordState({ busy: false, error: t("settings.security.mismatch"), success: null });
      return;
    }
    setPasswordState({ busy: true, error: null, success: null });
    try {
      await onPasswordChange(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordState({ busy: false, error: null, success: t("settings.security.success") });
    } catch (error) {
      setPasswordState({ busy: false, error: error instanceof Error ? error.message : t("errors.changePassword"), success: null });
    }
  };

  const logout = async () => {
    setIsLoggingOut(true);
    setAccountError(null);
    try {
      await onLogout();
      onBack();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : t("errors.logout"));
    } finally {
      setIsLoggingOut(false);
    }
  };

  const deleteAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deletePassword) {
      setDeleteState({ busy: false, error: t("settings.danger.passwordRequired") });
      return;
    }
    setDeleteState({ busy: true, error: null });
    try {
      await onDeleteAccount(deletePassword);
      setIsDeleteOpen(false);
      onBack();
    } catch (error) {
      setDeleteState({ busy: false, error: error instanceof Error ? error.message : t("errors.deleteAccount") });
    }
  };

  const uploadImage = async (file: File) => {
    setImageError(null);
    await onProfileImageUpload(file);
  };

  const removeImage = async () => {
    setIsRemovingImage(true);
    setImageError(null);
    try {
      await onProfileImageDelete();
    } catch (error) {
      setImageError(error instanceof Error ? error.message : t("settings.account.image.removeFailed"));
    } finally {
      setIsRemovingImage(false);
    }
  };

  return (
    <main className="settings-page">
      <div className="settings-shell">
        <header className="settings-header">
          <button className="settings-back" type="button" onClick={onBack}>← {t("settings.backToWorkspace")}</button>
          <h1>{t("settings.title")}</h1>
          <p>{t("settings.subtitle")}</p>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label={t("settings.title")}>
            <a href="#settings-general">{t("settings.sections.general")}</a>
            <a href="#settings-account">{t("settings.sections.account")}</a>
            {currentUser && <a href="#settings-security">{t("settings.sections.security")}</a>}
            <a href="#settings-privacy">{t("settings.sections.privacy")}</a>
            {currentUser && <a className="danger" href="#settings-danger">{t("settings.sections.danger")}</a>}
          </nav>

          <div className="settings-content">
            <section id="settings-general" className="settings-card">
              <h2>{t("settings.general.title")}</h2>
              <p>{t("settings.general.description")}</p>
              <label className="settings-control">
                <span>{t("settings.general.label")}</span>
                <select value={getCurrentLanguage()} onChange={(event) => void changeLanguage(event.target.value as SupportedLanguage)} disabled={isSavingLanguage}>
                  <option value="en">{t("language.english")}</option>
                  <option value="de">{t("language.german")}</option>
                </select>
              </label>
              {languageError && <p className="auth-error" role="alert">{languageError}</p>}
            </section>

            <section id="settings-account" className="settings-card">
              <h2>{t("settings.account.title")}</h2>
              {currentUser ? (
                <>
                  <div className="settings-account-summary">
                    <EntityThumbnail
                      src={profileImageUrl}
                      label={t("settings.account.image.alt", { username: currentUser.username })}
                      onUpload={uploadImage}
                      placeholder={currentUser.username.slice(0, 1).toLocaleUpperCase(i18n.language)}
                      className="profile-thumbnail"
                      addTitle={t("settings.account.image.upload")}
                      changeTitle={t("settings.account.image.change")}
                    />
                    <div><strong>{t("settings.account.signedInAs", { username: currentUser.username })}</strong><p>{t("settings.account.synced")}</p></div>
                  </div>
                  <div className="settings-profile-image-actions">
                    {currentUser.profileImageId && <button className="auth-secondary" type="button" onClick={() => void removeImage()} disabled={isRemovingImage}>{isRemovingImage ? t("settings.account.image.removing") : t("settings.account.image.remove")}</button>}
                    <small>{t("settings.account.image.help")}</small>
                  </div>
                  {imageError && <p className="auth-error" role="alert">{imageError}</p>}
                  {accountError && <p className="auth-error" role="alert">{accountError}</p>}
                  <button className="auth-secondary" type="button" onClick={() => void logout()} disabled={isLoggingOut}>{isLoggingOut ? t("settings.account.signingOut") : t("settings.account.signOut")}</button>
                </>
              ) : (
                <>
                  <h3>{t("settings.account.guestTitle")}</h3>
                  <p>{t("settings.account.guestDescription")}</p>
                  <div className="settings-inline-actions">
                    <button className="primary" type="button" onClick={() => onOpenAuth("login")}>{t("auth.login")}</button>
                    <button className="auth-secondary" type="button" onClick={() => onOpenAuth("register")}>{t("auth.register")}</button>
                  </div>
                </>
              )}
            </section>

            {currentUser && (
              <section id="settings-security" className="settings-card">
                <h2>{t("settings.security.title")}</h2>
                <p>{t("settings.security.description")}</p>
                <form className="settings-form" onSubmit={submitPassword}>
                  <label><span>{t("common.fields.currentPassword")}</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" disabled={passwordState.busy} /></label>
                  <label><span>{t("common.fields.newPassword")}</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" disabled={passwordState.busy} /></label>
                  <label><span>{t("common.fields.confirmPassword")}</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" disabled={passwordState.busy} /></label>
                  <small>{t("auth.passwordRule")}</small>
                  {passwordState.error && <p className="auth-error" role="alert">{passwordState.error}</p>}
                  {passwordState.success && <p className="auth-success" role="status">{passwordState.success}</p>}
                  <button className="primary" type="submit" disabled={passwordState.busy}>{passwordState.busy ? t("common.state.saving") : t("settings.security.submit")}</button>
                </form>
              </section>
            )}

            <section id="settings-privacy" className="settings-card">
              <h2>{t("settings.privacy.title")}</h2>
              <p>{t("settings.privacy.description")}</p>
              <button className="auth-secondary" type="button" onClick={() => setIsPrivacyOpen(true)}>{t("settings.privacy.openNotice")}</button>
            </section>

            {currentUser && (
              <section id="settings-danger" className="settings-card settings-danger-card">
                <h2>{t("settings.danger.title")}</h2>
                <p>{t("settings.danger.description")}</p>
                <button className="auth-danger" type="button" onClick={() => { setDeletePassword(""); setDeleteState({ busy: false, error: null }); setIsDeleteOpen(true); }}>{t("settings.danger.button")}</button>
              </section>
            )}
          </div>
        </div>
      </div>

      <PrivacyNoticeDialog isOpen={isPrivacyOpen} onClose={() => setIsPrivacyOpen(false)} />
      {isDeleteOpen && currentUser && (
        <div className="auth-dialog-backdrop" onClick={(event) => event.target === event.currentTarget && !deleteState.busy && setIsDeleteOpen(false)}>
          <div className="auth-dialog delete-account-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-account-title">
            <div className="auth-dialog-header">
              <div><h2 id="delete-account-title" className="auth-dialog-title">{t("settings.danger.dialogTitle")}</h2><p className="auth-dialog-subtitle">{t("settings.danger.dialogDescription", { username: currentUser.username })}</p></div>
              <button className="auth-close" type="button" onClick={() => setIsDeleteOpen(false)} disabled={deleteState.busy} aria-label={t("common.actions.close")}>×</button>
            </div>
            <form className="auth-form" onSubmit={deleteAccount}>
              <div className="auth-field"><label htmlFor="delete-current-password">{t("common.fields.currentPassword")}</label><input id="delete-current-password" className="auth-input" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" disabled={deleteState.busy} autoFocus /></div>
              {deleteState.error && <p className="auth-error" role="alert">{deleteState.error}</p>}
              <div className="auth-actions"><button className="auth-secondary" type="button" onClick={() => setIsDeleteOpen(false)} disabled={deleteState.busy}>{t("common.actions.cancel")}</button><button className="auth-danger" type="submit" disabled={deleteState.busy}>{deleteState.busy ? t("common.state.deleting") : t("settings.danger.confirm")}</button></div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
