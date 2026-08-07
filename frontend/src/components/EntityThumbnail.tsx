import { ChangeEvent, MouseEvent, useRef, useState } from "react";

type EntityThumbnailProps = {
  src: string | null;
  label: string;
  onUpload: (file: File) => Promise<void>;
  compact?: boolean;
};

export default function EntityThumbnail({ src, label, onUpload, compact = false }: EntityThumbnailProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const visibleSrc = src && src !== failedSrc ? src : null;

  const openPicker = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!isUploading) inputRef.current?.click();
  };

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setIsUploading(true);
    try {
      await onUpload(file);
      setFailedSrc(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to save thumbnail.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <span className="entity-thumbnail-control" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={`entity-thumbnail${compact ? " compact" : ""}${isUploading ? " uploading" : ""}`}
        title={`${visibleSrc ? "Change" : "Add"} thumbnail for ${label}`}
        aria-label={`${visibleSrc ? "Change" : "Add"} thumbnail for ${label}`}
        onClick={openPicker}
        disabled={isUploading}
      >
        {visibleSrc ? (
          <img src={visibleSrc} alt="" onError={() => setFailedSrc(src)} />
        ) : (
          <span className="entity-thumbnail-placeholder" aria-hidden="true">+</span>
        )}
        <span className="entity-thumbnail-overlay" aria-hidden="true">↥</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => void handleChange(event)}
        tabIndex={-1}
        aria-hidden="true"
      />
    </span>
  );
}
