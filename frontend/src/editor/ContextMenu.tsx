import { memo } from "react";

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
  copyLabel = "Copy Node",
  cutLabel = "Cut Node",
  duplicateLabel = "Duplicate Node",
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onDuplicate,
  onClose
}: ContextMenuProps) => {
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
      {onCopy && <button type="button" onClick={onCopy}>{copyLabel}</button>}
      {onCut && <button type="button" onClick={onCut}>{cutLabel}</button>}
      {onPaste && <button type="button" onClick={onPaste}>Paste Here</button>}
      {onDuplicate && <button type="button" onClick={onDuplicate}>{duplicateLabel}</button>}
      {onDelete && <button type="button" onClick={onDelete}>Delete</button>}
    </div>
  );
});

export default ContextMenu;
