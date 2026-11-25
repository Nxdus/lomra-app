"use client";

import { useEffect, useRef, useState } from "react";
import type { SdFile } from "@/components/sd-versions";
import { desktopSd } from "@/lib/desktop";

type Reply = { result: SdFile[] } | { error: string };
const requests = new Map<string, Promise<Reply>>();

/** The usable files of a Hugging Face repository; asked once, and again after a failure. */
export function loadSdFiles(repo: string, file?: string) {
  const key = file ? `${repo}/${file}` : repo;
  let request = requests.get(key);
  if (!request) {
    request = (async (): Promise<Reply> => {
      try { return await desktopSd()!.files(repo, file); } catch { return { error: "Restart Lomra to use this, then try again." }; }
    })().then((reply) => {
      if ("error" in reply) requests.delete(key);
      return reply;
    });
    requests.set(key, request);
  }
  return request;
}

/** The same for a row in a list, asked for when the row is first seen. Undefined while loading, null when it failed. */
export function useSdFiles(repo: string) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<SdFile[] | null>();
  useEffect(() => {
    let active = true;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      void loadSdFiles(repo).then((reply) => { if (active) setFiles("error" in reply ? null : reply.result); });
    });
    observer.observe(rowRef.current!);
    return () => { active = false; observer.disconnect(); };
  }, [repo]);
  return { files, rowRef };
}
