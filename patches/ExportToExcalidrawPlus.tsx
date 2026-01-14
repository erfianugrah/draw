// Modified ExportToExcalidrawPlus - uses self-hosted storage instead of Excalidraw's cloud
import React from "react";
import { Card } from "@excalidraw/excalidraw/components/Card";
import { ToolButton } from "@excalidraw/excalidraw/components/ToolButton";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";
import { saveFilesToFirebase } from "../data/firebase";
import type {
  FileId,
  NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import { nanoid } from "nanoid";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import {
  encryptData,
  generateEncryptionKey,
} from "@excalidraw/excalidraw/data/encryption";
import { isInitializedImageElement } from "@excalidraw/excalidraw/element/typeChecks";
import { FILE_UPLOAD_MAX_BYTES } from "../app_constants";
import { encodeFilesForUpload } from "../data/FileManager";
import { MIME_TYPES } from "@excalidraw/excalidraw/constants";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { getFrame } from "@excalidraw/excalidraw/utils";
import { ExcalidrawLogo } from "@excalidraw/excalidraw/components/ExcalidrawLogo";

const STORAGE_API =
  import.meta.env.VITE_APP_BACKEND_V2_GET_URL?.replace("/api/v2/", "") || "";

export const exportToExcalidrawPlus = async (
  elements: readonly NonDeletedExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
  name: string,
) => {
  const id = `${nanoid(12)}`;

  const encryptionKey = (await generateEncryptionKey())!;
  const encryptedData = await encryptData(
    encryptionKey,
    serializeAsJSON(elements, appState, files, "database"),
  );

  const blob = new Blob(
    [encryptedData.iv, new Uint8Array(encryptedData.encryptedBuffer)],
    {
      type: MIME_TYPES.binary,
    },
  );

  // Save to our self-hosted storage instead of Firebase
  const response = await fetch(`${STORAGE_API}/api/v2/exports/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: blob,
  });

  if (!response.ok) {
    throw new Error("Failed to save export");
  }

  const filesMap = new Map<FileId, BinaryFileData>();
  for (const element of elements) {
    if (isInitializedImageElement(element) && files[element.fileId]) {
      filesMap.set(element.fileId, files[element.fileId]);
    }
  }

  if (filesMap.size) {
    const filesToUpload = await encodeFilesForUpload({
      files: filesMap,
      encryptionKey,
      maxBytes: FILE_UPLOAD_MAX_BYTES,
    });

    await saveFilesToFirebase({
      prefix: `exports/files/${id}`,
      files: filesToUpload,
    });
  }

  // Generate shareable link to our own instance
  const shareUrl = `${window.location.origin}/#json=${id},${encryptionKey}`;
  
  // Copy to clipboard and open in new tab
  await navigator.clipboard.writeText(shareUrl);
  window.open(shareUrl, "_blank");
};

export const ExportToExcalidrawPlus: React.FC<{
  elements: readonly NonDeletedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  name: string;
  onError: (error: Error) => void;
  onSuccess: () => void;
}> = ({ elements, appState, files, name, onError, onSuccess }) => {
  const { t } = useI18n();
  return (
    <Card color="primary">
      <div className="Card-icon">
        <ExcalidrawLogo
          style={{
            ["--color-logo-icon" as any]: "#fff",
            width: "2.8rem",
            height: "2.8rem",
          }}
        />
      </div>
      <h2>Share Drawing</h2>
      <div className="Card-details">
        Create a shareable link to this drawing. The link will be copied to your
        clipboard.
      </div>
      <ToolButton
        className="Card-button"
        type="button"
        title="Create shareable link"
        aria-label="Create shareable link"
        showAriaLabel={true}
        onClick={async () => {
          try {
            trackEvent("export", "share", `ui (${getFrame()})`);
            await exportToExcalidrawPlus(elements, appState, files, name);
            onSuccess();
          } catch (error: any) {
            console.error(error);
            if (error.name !== "AbortError") {
              onError(new Error("Failed to create shareable link"));
            }
          }
        }}
      />
    </Card>
  );
};
