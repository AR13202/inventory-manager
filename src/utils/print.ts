"use client";

export const escapeHtml = (value: any) =>
    String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

export const openPrintWindow = (title: string, bodyHtml: string) => {
    const iframe = document.createElement("iframe");
    
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    
    document.body.appendChild(iframe);
    
    const iframeDoc = iframe.contentWindow?.document;
    if (!iframeDoc) {
        document.body.removeChild(iframe);
        throw new Error("Unable to create print frame.");
    }

    iframeDoc.open();
    iframeDoc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      margin: 0;
      padding: 24px;
      color: #0f172a;
      background: #ffffff;
    }
    h1, h2, h3 { margin: 0 0 10px; }
    p { margin: 0 0 10px; }
    .meta { color: #475569; font-size: 13px; margin-bottom: 18px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin: 18px 0 24px;
    }
    .card {
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 14px;
      background: #f8fafc;
    }
    .label {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 6px;
    }
    .value {
      font-size: 22px;
      font-weight: 700;
    }
    .section {
      margin-top: 22px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 13px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 10px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #e2e8f0;
    }
    .muted {
      color: #64748b;
    }
    @media print {
      body { padding: 16px; }
      .page-break { page-break-before: always; }
    }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`);
    iframeDoc.close();
    
    setTimeout(() => {
        if (iframe.contentWindow) {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        }
        
        setTimeout(() => {
            if (document.body.contains(iframe)) {
                document.body.removeChild(iframe);
            }
        }, 1000);
    }, 500);
};
