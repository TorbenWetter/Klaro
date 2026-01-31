<script lang="ts">
    import DOMPurify from "dompurify";
    import { marked } from "marked";

    interface Props {
        content: string;
        importance?: "primary" | "secondary";
    }
    let { content = "", importance }: Props = $props();

    const rawHtml = $derived(marked.parse(content, { async: false }) as string);
    const safeHtml = $derived(
        DOMPurify.sanitize(rawHtml, {
            ALLOWED_TAGS: [
                "p",
                "br",
                "strong",
                "em",
                "b",
                "i",
                "u",
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6",
                "ul",
                "ol",
                "li",
                "a",
                "blockquote",
                "code",
                "pre",
            ],
            ALLOWED_ATTR: ["href", "target", "rel"],
        }),
    );

    const baseClass = $derived("text-lg text-gray-900 leading-relaxed prose prose-lg max-w-none");
    const importanceClass = $derived(importance === "primary" ? "font-medium" : "");
</script>

<div class="sidebar-markdown {baseClass} {importanceClass}" data-block-type="markdown">
    {@html safeHtml}
</div>
