// Disabled ExportToExcalidrawPlus - this feature requires Excalidraw's cloud service
// For self-hosted instances, use the regular export options instead

import React from "react";
import { Card } from "@excalidraw/excalidraw/components/Card";
import type {
  NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import { ExcalidrawLogo } from "@excalidraw/excalidraw/components/ExcalidrawLogo";

export const exportToExcalidrawPlus = async (
  _elements: readonly NonDeletedExcalidrawElement[],
  _appState: Partial<AppState>,
  _files: BinaryFiles,
  _name: string,
) => {
  // Disabled for self-hosted - Excalidraw+ is a cloud service
  throw new Error("Export to Excalidraw+ is not available in self-hosted mode");
};

export const ExportToExcalidrawPlus: React.FC<{
  elements: readonly NonDeletedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  name: string;
  onError: (error: Error) => void;
  onSuccess: () => void;
}> = ({ onError }) => {
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
      <h2>Excalidraw+</h2>
      <div className="Card-details">
        This feature is not available in self-hosted mode.
        Use the regular export options instead.
      </div>
    </Card>
  );
};
