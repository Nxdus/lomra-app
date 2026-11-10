import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownMessage({ children }: { children: string }) {
  return (
    <div className="min-w-0 break-words text-sm [&_p]:whitespace-pre-wrap [&_p+p]:mt-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_h1,&_h2,&_h3,&_h4,&_h5,&_h6]:my-3 [&_h1,&_h2,&_h3,&_h4,&_h5,&_h6]:font-semibold [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_table]:my-3 [&_table]:block [&_table]:overflow-x-auto [&_th,&_td]:border [&_th,&_td]:px-3 [&_th,&_td]:py-2 [&_hr]:my-3 [&_img]:max-w-full">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml>{children}</Markdown>
    </div>
  );
}
