import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import rehypeSanitize from "rehype-sanitize";

function rehypeOpenLinksInNewTab() {
  function visit(node: unknown) {
    if (!node || typeof node !== "object") {
      return;
    }

    const element = node as {
      type?: string;
      tagName?: string;
      properties?: Record<string, unknown>;
      children?: unknown[];
    };

    if (element.type === "element" && element.tagName === "a") {
      element.properties = {
        ...element.properties,
        target: "_blank",
        rel: "noopener noreferrer",
      };
    }

    for (const child of element.children ?? []) {
      visit(child);
    }
  }

  return (tree: unknown) => {
    visit(tree);
  };
}

export async function renderMarkdown(source: string): Promise<string> {
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeOpenLinksInNewTab)
    .use(rehypeStringify)
    .process(normalizedSource);

  return String(result);
}
