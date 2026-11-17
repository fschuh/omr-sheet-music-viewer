// An engraved page as one image. A page drawn as SVG is thousands of text elements, one per
// glyph, and the browser regroups every one of them whenever anything on the page changes;
// as an image it is a single picture, so marks moving over it stay smooth. The image cannot
// use the document's fonts, so the music font travels inside it.
import { useEffect, useState } from "react";
import type { LayoutPage } from "../model/layout";
import { LELAND_URL, MusicXmlPageSurface } from "./MusicXmlPageSurface";

let fontDataUrl: Promise<string> | null = null;

function musicFont(): Promise<string> {
  fontDataUrl ??= fetch(LELAND_URL)
    .then((response) => response.blob())
    .then((blob) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }))
    .catch((error: unknown) => {
      fontDataUrl = null;
      throw error;
    });
  return fontDataUrl;
}

/** The page as an SVG image file, with the music font inside it. */
export async function pageImageMarkup(page: LayoutPage): Promise<string> {
  const [{ renderToStaticMarkup }, font] = await Promise.all([import("react-dom/server"), musicFont()]);
  return renderToStaticMarkup(<MusicXmlPageSurface page={page} />)
    .replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"')
    .replace(LELAND_URL, font);
}

// One image per laid-out page, decoded and ready to paint, kept while the page is; and the
// URLs of those already decoded, which a page shows from its first frame.
const images = new WeakMap<LayoutPage, Promise<string>>();
const decoded = new WeakMap<LayoutPage, string>();

// An image's URL keeps its file in memory until it is revoked: it is revoked when its page's
// layout is dropped, as when another score opens, see `releasePageImages`, or else once the
// layout is collected.
const releases = typeof FinalizationRegistry === "undefined"
  ? null
  : new FinalizationRegistry<string>((url) => URL.revokeObjectURL(url));

function pageImage(page: LayoutPage): Promise<string> {
  let image = images.get(page);
  if (!image) {
    const made: Promise<string> = pageImageMarkup(page).then(async (markup) => {
      const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
      releases?.register(page, url);
      // Decoded before it is shown, so swapping it for the SVG never leaves a blank frame.
      const decoder = new Image();
      decoder.src = url;
      await decoder.decode();
      // Released while it was being made: no page shows it.
      if (images.get(page) !== made) {
        URL.revokeObjectURL(url);
        throw new Error("The page's layout was dropped");
      }
      decoded.set(page, url);
      return url;
    });
    image = made;
    image.catch(() => {
      if (images.get(page) === made) images.delete(page);
    });
    images.set(page, image);
  }
  return image;
}

/**
 * Lets go of the pages' images, whose layouts are dropped, as when another score opens or
 * the score is laid out again: their files leave memory.
 */
export function releasePageImages(pages: readonly LayoutPage[]): void {
  for (const page of pages) {
    const image = images.get(page);
    if (!image) continue;
    images.delete(page);
    const url = decoded.get(page);
    decoded.delete(page);
    if (url) URL.revokeObjectURL(url);
  }
}

/** Prepares the pages' images one by one in idle time, so they are ready when first shown. */
export function preparePageImages(pages: readonly LayoutPage[]): () => void {
  let cancelled = false;
  let handle: number | null = null;
  const next = (index: number) => {
    if (cancelled || index >= pages.length || typeof requestIdleCallback === "undefined") return;
    handle = requestIdleCallback(() => {
      void pageImage(pages[index]).catch(() => undefined).finally(() => next(index + 1));
    }, { timeout: 5000 });
  };
  next(0);
  return () => {
    cancelled = true;
    if (handle !== null) cancelIdleCallback(handle);
  };
}

/**
 * The URL of the page's image once it is decoded, while `wanted`; null before. It is
 * prepared in idle time beforehand, so that it is usually ready when first wanted.
 */
export function usePageImage(page: LayoutPage, wanted: boolean): string | null {
  const [ready, setReady] = useState<{ page: LayoutPage; url: string } | null>(null);
  useEffect(() => {
    let disposed = false;
    const prepare = () => {
      pageImage(page)
        .then((url) => {
          if (!disposed) setReady({ page, url });
        })
        .catch((error: unknown) => console.warn("The page could not be drawn as an image", error));
    };
    if (wanted || typeof requestIdleCallback === "undefined") {
      prepare();
      return () => { disposed = true; };
    }
    const idle = requestIdleCallback(prepare, { timeout: 5000 });
    return () => {
      disposed = true;
      cancelIdleCallback(idle);
    };
  }, [page, wanted]);
  if (!wanted) return null;
  return ready?.page === page ? ready.url : decoded.get(page) ?? null;
}
