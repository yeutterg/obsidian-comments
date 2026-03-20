"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";

interface TocEntry {
  id: string;
  text: string;
  level: number;
}

function extractHeadings(html: string): TocEntry[] {
  if (typeof DOMParser === "undefined" || !html) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const headings: TocEntry[] = [];
  doc.querySelectorAll("h2, h3").forEach((el, i) => {
    const text = el.textContent?.trim() || "";
    if (!text) return;
    const id = el.id || `heading-${i}`;
    headings.push({ id, text, level: parseInt(el.tagName[1], 10) });
  });
  return headings;
}

export function useTableOfContents(html: string | null) {
  const headings = useMemo(() => extractHeadings(html || ""), [html]);
  return headings;
}

export function TableOfContentsSidebar({
  headings,
  contentRef,
}: {
  headings: TocEntry[];
  contentRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const container = contentRef.current;
    if (!container || headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );

    for (const heading of headings) {
      const el = container.querySelector(`#${CSS.escape(heading.id)}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [headings, contentRef]);

  if (headings.length < 2) return null;

  return (
    <nav className="toc-sidebar" aria-label="Table of contents">
      <button
        type="button"
        className="toc-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="toc-label">On this page</span>
        {collapsed ? (
          <ChevronRightIcon width={12} height={12} />
        ) : (
          <ChevronDownIcon width={12} height={12} />
        )}
      </button>
      {!collapsed ? (
        <div className="toc-list">
          {headings.map((heading) => (
            <a
              key={heading.id}
              href={`#${heading.id}`}
              className={`toc-item ${heading.level === 3 ? "toc-item-nested" : ""} ${activeId === heading.id ? "toc-item-active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                const el = contentRef.current?.querySelector(`#${CSS.escape(heading.id)}`);
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
                setActiveId(heading.id);
              }}
            >
              {heading.text}
            </a>
          ))}
        </div>
      ) : null}
    </nav>
  );
}

export function TableOfContentsMobile({
  headings,
  contentRef,
}: {
  headings: TocEntry[];
  contentRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const container = contentRef.current;
    if (!container || headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-60px 0px -70% 0px", threshold: 0 }
    );

    for (const heading of headings) {
      const el = container.querySelector(`#${CSS.escape(heading.id)}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [headings, contentRef]);

  if (headings.length < 2) return null;

  return (
    <div className="toc-mobile">
      <button
        type="button"
        className="toc-mobile-header"
        onClick={() => setOpen(!open)}
      >
        <span className="toc-label">On this page</span>
        {open ? (
          <ChevronDownIcon width={14} height={14} />
        ) : (
          <ChevronRightIcon width={14} height={14} />
        )}
      </button>
      {open ? (
        <div className="toc-mobile-list">
          {headings.map((heading) => (
            <a
              key={heading.id}
              href={`#${heading.id}`}
              className={`toc-item ${heading.level === 3 ? "toc-item-nested" : ""} ${activeId === heading.id ? "toc-item-active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                const el = contentRef.current?.querySelector(`#${CSS.escape(heading.id)}`);
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
                setActiveId(heading.id);
                setOpen(false);
              }}
            >
              {heading.text}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
