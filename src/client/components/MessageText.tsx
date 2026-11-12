import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export function MessageText({ text }: { text: string }) {
  return (
    <div className="message-content min-w-0 break-words">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-4 max-w-full overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
