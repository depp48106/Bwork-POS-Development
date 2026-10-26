import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchAuthenticatedBlob } from '../utils/authenticatedFile';

/**
 * React Hook to safely fetch and display authenticated private images.
 * Handles JWT Authorization headers, converts response to Blob Object URL,
 * and automatically revokes Blob URLs to prevent browser memory leaks.
 *
 * @param {string|null} src - Image URL (or data URL / blob URL)
 * @returns {{ blobUrl: string|null, loading: boolean, error: string|null, retry: () => void }}
 */
export function useAuthenticatedImage(src) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  const revokeRef = useRef(null);

  const retry = useCallback(() => {
    setReloadCounter(c => c + 1);
  }, []);

  useEffect(() => {
    // Revoke previous blob URL if any
    if (revokeRef.current) {
      revokeRef.current();
      revokeRef.current = null;
    }

    if (!src || src === 'uploaded') {
      setBlobUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Direct bypass for data: or blob:
    if (src.startsWith('data:') || src.startsWith('blob:')) {
      setBlobUrl(src);
      setLoading(false);
      setError(null);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchAuthenticatedBlob(src, controller.signal)
      .then(result => {
        if (!isMounted) {
          result.revoke();
          return;
        }
        revokeRef.current = result.revoke;
        setBlobUrl(result.blobUrl);
        setLoading(false);
      })
      .catch(err => {
        if (!isMounted || controller.signal.aborted) return;
        console.error('[useAuthenticatedImage] Error loading image:', src, err);
        setError(err.message || 'ไม่สามารถโหลดรูปภาพได้');
        setLoading(false);
      });

    return () => {
      isMounted = false;
      controller.abort();
      if (revokeRef.current) {
        revokeRef.current();
        revokeRef.current = null;
      }
    };
  }, [src, reloadCounter]);

  return { blobUrl, loading, error, retry };
}
