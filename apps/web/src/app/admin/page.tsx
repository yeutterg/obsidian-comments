import DirectoryPageClient from "@/components/DirectoryPageClient";
import { fetchAdminNotes } from "@/lib/api";
import type { NoteSummary } from "@obsidian-comments/shared";

export const dynamic = "force-dynamic";

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  let notes: NoteSummary[] = [];
  let error: string | null = null;
  let warnings: string[] = [];

  try {
    const result = await fetchAdminNotes();
    notes = result.notes;
    error = result.error;
    warnings = result.warnings;
  } catch (loadError) {
    console.error("Admin page failed to load notes", loadError);
    error = loadError instanceof Error ? loadError.message : "Failed to load notes";
  }

  return <DirectoryPageClient notes={notes} error={error} warnings={warnings} admin initialQuery={typeof q === "string" ? q : ""} />;
}
