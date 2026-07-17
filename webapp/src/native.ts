import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PageArtifacts, VisualSidecar } from "./types";

export type WorkerEvent =
  | {
      type: "hello";
      protocol: number;
      workerVersion: string;
      homrVersion: string;
    }
  | {
      type: "job_started";
      jobId: string;
      documentName: string;
      pageCount: number;
      cacheStatus: "miss" | "partial" | "complete";
      cachePath: string;
    }
  | { type: "page_started"; jobId: string; pageIndex: number }
  | {
      type: "page_completed";
      jobId: string;
      pageIndex: number;
      cached: boolean;
      artifacts: PageArtifacts;
    }
  | {
      type: "page_failed";
      jobId: string;
      pageIndex: number;
      error: { message: string };
    }
  | {
      type: "job_completed";
      jobId: string;
      status: "complete" | "partial" | "cancelled";
      completedPages?: number;
      failedPages?: number;
    }
  | { type: "job_failed"; jobId: string; error: { message: string } }
  | { type: "worker_log"; line: string }
  | { type: "protocol_error" | "worker_stopped"; message: string };

interface PageArtifactData {
  musicXml: string;
  visualSidecar: VisualSidecar;
}

export function nativeViewerAvailable(): boolean {
  return isTauri();
}

export async function choosePdf(): Promise<string | null> {
  return invoke<string | null>("choose_pdf");
}

export async function openPdf(path: string): Promise<string> {
  return invoke<string>("open_pdf", { path });
}

export async function cancelJob(jobId: string): Promise<void> {
  return invoke("cancel_job", { jobId });
}

export async function retryPage(jobId: string, pageIndex: number): Promise<void> {
  return invoke("retry_page", { jobId, pageIndex });
}

export async function getWorkerLogPath(): Promise<string> {
  return invoke<string>("get_worker_log_path");
}

export async function openCacheDirectory(path: string): Promise<void> {
  return invoke("open_cache_directory", { path });
}

export async function loadPageArtifacts(artifacts: PageArtifacts): Promise<PageArtifactData> {
  return invoke<PageArtifactData>("load_page_artifacts", {
    musicXmlPath: artifacts.musicXmlPath,
    visualSidecarPath: artifacts.visualSidecarPath,
  });
}

export function pageImageUrl(path: string): string {
  return convertFileSrc(path);
}

export async function subscribeToWorkerEvents(
  callback: (event: WorkerEvent) => void,
): Promise<UnlistenFn> {
  return listen<WorkerEvent>("worker-event", ({ payload }) => callback(payload));
}
