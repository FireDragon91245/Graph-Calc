import { memo } from "react";
import { useTranslation } from "react-i18next";

type ContextMenuProps = {
  top: number;
  left: number;
  copyLabel?: string;
  cutLabel?: string;
  duplicateLabel?: string;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onClose: () => void;
};

const ContextMenu = memo(({
  top,
  left,
  copyLabel,
  cutLabel,
  duplicateLabel,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onDuplicate,
  onClose
}: ContextMenuProps) => {
  const { t } = useTranslation();
  return (
    <div
      style={{
        top,
        left,
        position: "absolute",
        zIndex: 1000,
      }}
      className="context-menu"
      onClick={onClose}
    >
      {onCopy && <button type="button" onClick={onCopy}>{copyLabel ?? t("ui.context.copyNode")}</button>}
      {onCut && <button type="button" onClick={onCut}>{cutLabel ?? t("ui.context.cutNode")}</button>}
      {onPaste && <button type="button" onClick={onPaste}>{t("ui.context.paste")}</button>}
      {onDuplicate && <button type="button" onClick={onDuplicate}>{duplicateLabel ?? t("ui.context.duplicateNode")}</button>}
      {onDelete && <button type="button" onClick={onDelete}>{t("ui.context.delete")}</button>}
    </div>
  );
});

export default ContextMenu;
