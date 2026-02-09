import { memo } from "react";

type ContextMenuProps = {
  top: number;
  left: number;
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
};

const ContextMenu = memo(({ top, left, onDelete, onDuplicate, onClose }: ContextMenuProps) => {
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
      <button onClick={onDuplicate}>Duplicate</button>
      <button onClick={onDelete}>Delete</button>
    </div>
  );
});

export default ContextMenu;
