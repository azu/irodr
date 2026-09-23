import MarkdownIt from "markdown-it";

// Raw HTML stays text; markdown-it also rejects unsafe link and image schemes.
// The UI sanitizes the result again at display time.
const markdown = new MarkdownIt({ html: false, linkify: true });
const validateLink = markdown.validateLink.bind(markdown);
// Relative destinations would resolve against irodr instead of the repository.
// Require explicit HTTP(S) URLs for links and images rather than guessing a base.
markdown.validateLink = (url: string) => /^https?:\/\//i.test(url) && validateLink(url);

export function renderMarkdown(source: string): string {
    return markdown.render(source);
}
