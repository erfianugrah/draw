// Custom firebase.ts replacement - uses self-hosted storage instead of Firebase
import { reconcileElements } from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import { getSceneVersion } from "@excalidraw/excalidraw/element";
import type Portal from "../collab/Portal";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import type {
  AppState,
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "@excalidraw/excalidraw/types";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
  encryptData,
  decryptData,
} from "@excalidraw/excalidraw/data/encryption";
import { MIME_TYPES } from "@excalidraw/excalidraw/constants";
import type { SyncableExcalidrawElement } from ".";
import { getSyncableElements } from ".";
import type { Socket } from "socket.io-client";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";

// Use our self-hosted storage API
const STORAGE_API = import.meta.env.VITE_APP_BACKEND_V2_GET_URL?.replace('/api/v2/', '') || '';

// Scene version cache
class SceneVersionCache {
  private static cache = new WeakMap<Socket, number>();
  static get = (socket: Socket) => SceneVersionCache.cache.get(socket);
  static set = (socket: Socket, elements: readonly SyncableExcalidrawElement[]) => {
    SceneVersionCache.cache.set(socket, getSceneVersion(elements));
  };
}

export const isSavedToFirebase = (
  portal: Portal,
  elements: readonly ExcalidrawElement[],
): boolean => {
  if (portal.socket && portal.roomId && portal.roomKey) {
    const sceneVersion = getSceneVersion(elements);
    return SceneVersionCache.get(portal.socket) === sceneVersion;
  }
  return true;
};

const encryptElements = async (
  key: string,
  elements: readonly ExcalidrawElement[],
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> => {
  const json = JSON.stringify(elements);
  const encoded = new TextEncoder().encode(json);
  const { encryptedBuffer, iv } = await encryptData(key, encoded);
  return { ciphertext: encryptedBuffer, iv };
};

const decryptElements = async (
  iv: Uint8Array,
  ciphertext: Uint8Array,
  roomKey: string,
): Promise<readonly ExcalidrawElement[]> => {
  const decrypted = await decryptData(iv, ciphertext, roomKey);
  const decodedData = new TextDecoder("utf-8").decode(new Uint8Array(decrypted));
  return JSON.parse(decodedData);
};

export const saveFilesToFirebase = async ({
  prefix,
  files,
}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}) => {
  const erroredFiles: FileId[] = [];
  const savedFiles: FileId[] = [];

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        const response = await fetch(`${STORAGE_API}/api/v2/files/${prefix}/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: buffer,
        });
        if (response.ok) {
          savedFiles.push(id);
        } else {
          erroredFiles.push(id);
        }
      } catch (error) {
        erroredFiles.push(id);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

export const saveToFirebase = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  appState: AppState,
) => {
  const { roomId, roomKey, socket } = portal;
  if (!roomId || !roomKey || !socket || isSavedToFirebase(portal, elements)) {
    return null;
  }

  try {
    // Get existing room data
    const existingResponse = await fetch(`${STORAGE_API}/api/v2/rooms/${roomId}`);
    let reconciledElements = elements;

    if (existingResponse.ok) {
      const existingData = await existingResponse.json();
      if (existingData.ciphertext && existingData.iv) {
        const iv = Uint8Array.from(atob(existingData.iv), c => c.charCodeAt(0));
        const ciphertext = Uint8Array.from(atob(existingData.ciphertext), c => c.charCodeAt(0));
        const prevElements = getSyncableElements(
          restoreElements(await decryptElements(iv, ciphertext, roomKey), null),
        );
        reconciledElements = getSyncableElements(
          reconcileElements(
            elements,
            prevElements as OrderedExcalidrawElement[] as RemoteExcalidrawElement[],
            appState,
          ),
        );
      }
    }

    // Encrypt and save
    const { ciphertext, iv } = await encryptElements(roomKey, reconciledElements);
    const sceneVersion = getSceneVersion(reconciledElements);

    const response = await fetch(`${STORAGE_API}/api/v2/rooms/${roomId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneVersion,
        iv: btoa(String.fromCharCode(...iv)),
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save room');
    }

    SceneVersionCache.set(socket, reconciledElements);
    return reconciledElements;
  } catch (error) {
    console.error('Error saving to storage:', error);
    return null;
  }
};

export const loadFromFirebase = async (
  roomId: string,
  roomKey: string,
  socket: Socket | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
  try {
    const response = await fetch(`${STORAGE_API}/api/v2/rooms/${roomId}`);
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!data.ciphertext || !data.iv) {
      return null;
    }

    const iv = Uint8Array.from(atob(data.iv), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(data.ciphertext), c => c.charCodeAt(0));
    const elements = getSyncableElements(
      restoreElements(await decryptElements(iv, ciphertext, roomKey), null),
    );

    if (socket) {
      SceneVersionCache.set(socket, elements);
    }

    return elements;
  } catch (error) {
    console.error('Error loading from storage:', error);
    return null;
  }
};

export const loadFilesFromFirebase = async (
  prefix: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
) => {
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        const response = await fetch(`${STORAGE_API}/api/v2/files/${prefix}/${id}`);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const { data, metadata } = await decompressData<BinaryFileMetadata>(
            new Uint8Array(arrayBuffer),
            { decryptionKey },
          );

          const dataURL = new TextDecoder().decode(data) as DataURL;

          loadedFiles.push({
            mimeType: metadata.mimeType || MIME_TYPES.binary,
            id,
            dataURL,
            created: metadata?.created || Date.now(),
            lastRetrieved: Date.now(),
          });
        } else {
          erroredFiles.set(id, true);
        }
      } catch (error) {
        erroredFiles.set(id, true);
        console.error(error);
      }
    }),
  );

  return { loadedFiles, erroredFiles };
};

// Stub for compatibility
export const loadFirebaseStorage = async () => {
  return null;
};
