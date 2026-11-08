"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Hashes never reach the server: preserve them in the client redirect. */
export default function TasksPage() {
  const router = useRouter();
  useEffect(() => { router.replace(`/${window.location.search}${window.location.hash}`); }, [router]);
  return <p role="status">Opening Home…</p>;
}
