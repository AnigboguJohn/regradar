/**
 * Export a conversation with Remi, either as a plain-text file or as a PDF.
 * The PDF is made by the browser's print dialog ("Save as PDF"), from a clean
 * printable page rendered in a hidden frame, so no extra library is needed.
 */
import type { Citation } from "./api";

export interface ExportMessage { question: string; answer: string; citations: Citation[]; created_at?: string }

const stamp = () => new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const fileName = (title: string, ext: string) =>
  `Remi - ${title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "conversation"}.${ext}`;

function source(c: Citation) {
  return [c.title, c.ref_no, c.page ? `p. ${c.page}` : null, c.url].filter(Boolean).join(" · ");
}

export function exportAsText(title: string, msgs: ExportMessage[]) {
  const body = msgs.map((m) => {
    const sources = m.citations.length ? `\n\nSources:\n${m.citations.map((c) => `  [${c.n}] ${source(c)}`).join("\n")}` : "";
    return `You:\n${m.question}\n\nRemi:\n${m.answer}${sources}`;
  }).join(`\n\n${"-".repeat(60)}\n\n`);
  const text = `${title}\nConversation with Remi (RegRadar), exported ${stamp()}\n\n${"=".repeat(60)}\n\n${body}\n`;
  download(new Blob([text], { type: "text/plain;charset=utf-8" }), fileName(title, "txt"));
}

export function exportAsPdf(title: string, msgs: ExportMessage[]) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
  const para = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
  const turns = msgs.map((m) => `
    <section>
      <div class="who">You</div><div class="q">${para(m.question)}</div>
      <div class="who remi">Remi</div><div class="a">${para(m.answer)}</div>
      ${m.citations.length ? `<ol class="src">${m.citations.map((c) => `<li value="${c.n}">${esc(source(c))}</li>`).join("")}</ol>` : ""}
    </section>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(fileName(title, "pdf").replace(/\.pdf$/, ""))}</title>
    <style>
      @page { margin: 18mm; }
      body { font: 11pt/1.55 -apple-system, "Segoe UI", Inter, Arial, sans-serif; color: #0f172a; }
      header { border-bottom: 2px solid #6d28d9; padding-bottom: 8px; margin-bottom: 18px; }
      h1 { font-size: 16pt; margin: 0 0 2px; } .meta { color: #64748b; font-size: 9pt; }
      section { break-inside: avoid-page; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid #e2e8f0; }
      .who { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #64748b; margin-top: 8px; }
      .who.remi { color: #6d28d9; } .q p { font-weight: 600; } p { margin: 4px 0; }
      .src { font-size: 9pt; color: #475569; margin: 8px 0 0; padding-left: 22px; }
      footer { color: #94a3b8; font-size: 8.5pt; margin-top: 12px; }
    </style></head><body>
    <header><h1>${esc(title)}</h1><div class="meta">Conversation with Remi · RegRadar · exported ${esc(stamp())}</div></header>
    ${turns}
    <footer>Answers are drawn from indexed regulations and your policies. This is not legal advice.</footer>
    </body></html>`;

  const frame = Object.assign(document.createElement("iframe"), { title: "Print conversation" });
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open(); doc.write(html); doc.close();
  // Give the frame a moment to lay out, then open the print dialog; remove the frame afterwards.
  setTimeout(() => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 1000);
  }, 250);
}

// The link must be in the page for some browsers to start the download, and the file URL must
// outlive the click, so both are cleaned up a moment later.
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name, rel: "noopener" });
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}
