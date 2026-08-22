import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * Renders LLM output as GitHub-flavored Markdown inside the selection toolbar
 * popover. Styles are injected into the same Shadow DOM tree so they stay
 * isolated from the host page, mirroring the inline <style> usage in
 * selection-toolbar.tsx.
 */
export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="vibe-md" style={{ padding: "14px 18px", fontSize: "14px", lineHeight: 1.6, color: "#1f2937" }}>
      <style>
        {`
        .vibe-md h1, .vibe-md h2, .vibe-md h3, .vibe-md h4 {
          margin: 14px 0 6px;
          line-height: 1.35;
          font-weight: 700;
          color: #111827;
        }
        .vibe-md h1 { font-size: 18px; }
        .vibe-md h2 { font-size: 16px; }
        .vibe-md h3, .vibe-md h4 { font-size: 14px; }
        .vibe-md p { margin: 6px 0; }
        .vibe-md ul, .vibe-md ol { margin: 6px 0; padding-left: 22px; }
        .vibe-md li { margin: 3px 0; }
        .vibe-md table {
          border-collapse: collapse;
          margin: 8px 0;
          max-width: 100%;
          display: block;
          overflow-x: auto;
        }
        .vibe-md th, .vibe-md td {
          border: 1px solid #e5e7eb;
          padding: 4px 8px;
          font-size: 13px;
          text-align: left;
          vertical-align: top;
          white-space: nowrap;
        }
        .vibe-md th { background: #f9fafb; font-weight: 600; }
        .vibe-md pre {
          background: #f6f8fa;
          border-radius: 6px;
          padding: 10px 12px;
          overflow-x: auto;
          margin: 8px 0;
        }
        .vibe-md code {
          font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
          font-size: 12.5px;
          background: #f3f4f6;
          padding: 1px 4px;
          border-radius: 4px;
        }
        .vibe-md pre code { background: transparent; padding: 0; white-space: pre; }
        .vibe-md hr { border: none; border-top: 1px solid #e5e7eb; margin: 12px 0; }
        .vibe-md blockquote {
          border-left: 3px solid #d1d5db;
          margin: 8px 0;
          padding: 2px 10px;
          color: #6b7280;
        }
        .vibe-md strong { color: #111827; }
        .vibe-md > *:first-child { margin-top: 0; }
        .vibe-md > *:last-child { margin-bottom: 0; }
      `}
      </style>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
