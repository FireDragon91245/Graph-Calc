import { useTranslation } from "react-i18next";

type PrivacyNoticeDialogProps = { isOpen: boolean; onClose: () => void };

const listSections = ["account", "processed", "notUsed", "security", "disclaimer"] as const;

export default function PrivacyNoticeDialog({ isOpen, onClose }: PrivacyNoticeDialogProps) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const getItems = (section: (typeof listSections)[number]) => t(`privacy.${section}.items`, { returnObjects: true }) as unknown as string[];

  return (
    <div className="auth-dialog-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="privacy-dialog" role="dialog" aria-modal="true" aria-label={t("privacy.title")}>
        <div className="auth-dialog-header privacy-dialog-header">
          <div><h2 className="auth-dialog-title">{t("privacy.title")}</h2><p className="auth-dialog-subtitle">{t("privacy.lastUpdated")}</p></div>
          <button className="auth-close" type="button" onClick={onClose} aria-label={t("privacy.closeLabel")}>×</button>
        </div>
        <div className="privacy-dialog-body">
          <section className="privacy-section"><h3>{t("privacy.scope.title")}</h3><p>{t("privacy.scope.body")}</p></section>
          <section className="privacy-section"><h3>{t("privacy.account.title")}</h3><ul>{getItems("account").map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section className="privacy-section"><h3>{t("privacy.guestStorage.title")}</h3><p>{t("privacy.guestStorage.body")}</p></section>
          <section className="privacy-section"><h3>{t("privacy.sessions.title")}</h3><p>{t("privacy.sessions.body")}</p></section>
          <section className="privacy-section"><h3>{t("privacy.processed.title")}</h3><ul>{getItems("processed").map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section className="privacy-section"><h3>{t("privacy.notUsed.title")}</h3><ul>{getItems("notUsed").map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section className="privacy-section"><h3>{t("privacy.security.title")}</h3><div className="privacy-callout info">{t("privacy.security.callout")}</div><ul>{getItems("security").map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section className="privacy-section"><h3>{t("privacy.retention.title")}</h3><div className="privacy-callout warning">{t("privacy.retention.warning")}</div><p>{t("privacy.retention.body")}</p></section>
          <section className="privacy-section"><h3>{t("privacy.restriction.title")}</h3><p>{t("privacy.restriction.body")}</p></section>
          <section className="privacy-section"><h3>{t("privacy.administration.title")}</h3><p>{t("privacy.administration.body")}</p></section>
          <section className="privacy-section"><h3>{t("privacy.disclaimer.title")}</h3><ul>{getItems("disclaimer").map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section className="privacy-section"><h3>{t("privacy.changes.title")}</h3><p>{t("privacy.changes.body")}</p></section>
        </div>
        <div className="auth-actions"><button className="primary" type="button" onClick={onClose}>{t("privacy.close")}</button></div>
      </div>
    </div>
  );
}
