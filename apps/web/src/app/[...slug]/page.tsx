import { notFound } from "next/navigation";
import Link from "next/link";
import NoteViewerWrapper from "./NoteViewerWrapper";
import { fetchNoteDetail, fetchNotes } from "@/lib/api";
import type { NoteDetailResponse } from "@obsidian-comments/shared";

export const dynamic = "force-dynamic";

function joinSlug(parts: string[]) {
  return parts.map((part) => decodeURIComponent(part)).join("/");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;

  try {
    const detail = await fetchNoteDetail(joinSlug(slug));
    return {
      title: `${detail.note.title} - Obsidian Comments`,
    };
  } catch {
    return { title: "Not Found" };
  }
}

export default async function NotePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const requestedSlug = joinSlug(slug);
  let detail: NoteDetailResponse | null = null;

  try {
    detail = await fetchNoteDetail(requestedSlug);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      notFound();
    }
    console.error("Failed to load note detail", { slug: requestedSlug, error });
    // Hard fallback: use list metadata so note page still opens instead of crashing.
    try {
      const fallback = await fetchNotes();
      const summary = fallback.notes.find((note) => note.slug === requestedSlug);
      if (summary) {
        detail = {
          note: summary,
          authorized: true,
          html: null,
          markdown: null,
          subtitle: null,
          frontmatterFields: [],
          backlinks: [],
          breadcrumbs: summary.path.replace(/\.md$/i, "").split("/").filter(Boolean),
        };
      }
    } catch (fallbackError) {
      console.error("Failed to build note fallback detail", { slug: requestedSlug, fallbackError });
    }
  }

  if (!detail) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 560, width: "100%", border: "1px solid var(--border)", background: "var(--card)", padding: 20 }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 20 }}>Unable to load note</h1>
          <p style={{ margin: "0 0 16px", color: "var(--muted-foreground)" }}>
            This note could not be loaded right now.
          </p>
          <Link href="/" style={{ color: "var(--accent)", textDecoration: "underline" }}>Back to directory</Link>
        </div>
      </main>
    );
  }

  return <NoteViewerWrapper initialDetail={detail} />;
}
