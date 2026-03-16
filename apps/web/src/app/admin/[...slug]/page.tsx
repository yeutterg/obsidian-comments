import { notFound } from "next/navigation";
import Link from "next/link";
import type { NoteDetailResponse } from "@obsidian-comments/shared";
import { fetchAdminNoteDetail, fetchAdminNotes } from "@/lib/api";
import NoteViewerWrapper from "../../[...slug]/NoteViewerWrapper";

export const dynamic = "force-dynamic";

function joinSlug(parts: string[]) {
  return parts.map((part) => decodeURIComponent(part)).join("/");
}

export default async function AdminNotePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const requestedSlug = joinSlug(slug);
  let detail: NoteDetailResponse | null = null;

  try {
    detail = await fetchAdminNoteDetail(requestedSlug);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      notFound();
    }
    console.error("Failed to load admin note detail", { slug: requestedSlug, error });
    try {
      const fallback = await fetchAdminNotes();
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
      console.error("Failed to build admin note fallback detail", { slug: requestedSlug, fallbackError });
    }
  }

  if (!detail) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div className="vault-alert vault-alert-error" style={{ maxWidth: 560 }}>
          <strong>Unable to load note.</strong>
          <p>This note could not be loaded right now.</p>
          <Link href="/admin">Back to admin directory</Link>
        </div>
      </main>
    );
  }

  return <NoteViewerWrapper initialDetail={detail} adminMode />;
}
