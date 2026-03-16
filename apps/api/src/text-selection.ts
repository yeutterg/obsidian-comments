import { unified } from "unified";
import remarkParse from "remark-parse";

interface MarkdownNode {
  type?: string;
  value?: string;
  children?: MarkdownNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}

interface TextSpan {
  value: string;
  visibleStart: number;
  visibleEnd: number;
  sourceStart: number;
}

function collectTextSpans(node: MarkdownNode, spans: TextSpan[], visibleOffset: { value: number }) {
  if (node.type === "text" && typeof node.value === "string") {
    const sourceStart = node.position?.start?.offset;
    const sourceEnd = node.position?.end?.offset;
    if (typeof sourceStart === "number" && typeof sourceEnd === "number") {
      const spanLength = node.value.length;
      spans.push({
        value: node.value,
        visibleStart: visibleOffset.value,
        visibleEnd: visibleOffset.value + spanLength,
        sourceStart,
      });
      visibleOffset.value += spanLength;
    }
    return;
  }

  if (node.type === "break") {
    visibleOffset.value += 1;
    return;
  }

  for (const child of node.children ?? []) {
    collectTextSpans(child, spans, visibleOffset);
  }
}

export function replaceSelectionInMarkdown(source: string, input: {
  anchorText: string;
  anchorStart: number;
  anchorEnd: number;
  replacementText: string;
}) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const tree = unified().use(remarkParse).parse(normalized) as MarkdownNode;
  const spans: TextSpan[] = [];
  collectTextSpans(tree, spans, { value: 0 });

  const target = spans.find(
    (span) => input.anchorStart >= span.visibleStart && input.anchorEnd <= span.visibleEnd,
  );
  if (input.anchorEnd <= input.anchorStart) {
    return null;
  }

  if (target) {
    const localStart = input.anchorStart - target.visibleStart;
    const localEnd = input.anchorEnd - target.visibleStart;
    if (
      localStart >= 0 &&
      localEnd <= target.value.length &&
      localStart < localEnd &&
      target.value.slice(localStart, localEnd) === input.anchorText
    ) {
      const sourceStart = target.sourceStart + localStart;
      const sourceEnd = target.sourceStart + localEnd;
      return `${normalized.slice(0, sourceStart)}${input.replacementText}${normalized.slice(sourceEnd)}`;
    }
  }

  const fallbackCandidates: Array<{
    visibleStart: number;
    visibleEnd: number;
    sourceStart: number;
    sourceEnd: number;
  }> = [];

  for (const span of spans) {
    let searchIndex = span.value.indexOf(input.anchorText);
    while (searchIndex !== -1) {
      fallbackCandidates.push({
        visibleStart: span.visibleStart + searchIndex,
        visibleEnd: span.visibleStart + searchIndex + input.anchorText.length,
        sourceStart: span.sourceStart + searchIndex,
        sourceEnd: span.sourceStart + searchIndex + input.anchorText.length,
      });
      searchIndex = span.value.indexOf(input.anchorText, searchIndex + 1);
    }
  }

  if (fallbackCandidates.length === 0) {
    return null;
  }

  fallbackCandidates.sort((left, right) => {
    const leftDistance = Math.abs(left.visibleStart - input.anchorStart) + Math.abs(left.visibleEnd - input.anchorEnd);
    const rightDistance = Math.abs(right.visibleStart - input.anchorStart) + Math.abs(right.visibleEnd - input.anchorEnd);
    return leftDistance - rightDistance;
  });

  const best = fallbackCandidates[0];
  return `${normalized.slice(0, best.sourceStart)}${input.replacementText}${normalized.slice(best.sourceEnd)}`;
}
