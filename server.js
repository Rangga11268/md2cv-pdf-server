const express = require('express');
const cors = require('cors');
const { marked } = require('marked');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── HTML Template ────────────────────────────────────────────────────────────
const htmlTemplate = ({ bodyContent, fontFamily, fontSize, lineHeight, marginTB, marginLR, headingColor }) => `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <title>Resume</title>
    <style>
        @page {
            size: A4;
            margin: ${marginTB}cm ${marginLR}cm ${marginTB}cm ${marginLR}cm;
        }
        
        * { box-sizing: border-box; }

        body {
            font-family: ${fontFamily};
            color: #000000;
            line-height: ${lineHeight};
            margin: 0;
            padding: 0;
            font-size: ${fontSize}pt;
            background-color: #ffffff;
        }

        h1 {
            font-size: 1.75em;
            font-weight: bold;
            text-transform: uppercase;
            margin: 0 0 2px 0;
            color: ${headingColor};
            text-align: center;
            letter-spacing: 0.5px;
        }

        .job-title {
            text-align: center;
            font-size: 1.1em;
            font-weight: bold;
            letter-spacing: 0.5px;
            margin: 0 0 4px 0;
            color: ${headingColor};
            text-transform: uppercase;
        }

        .contact-details, .contact-links {
            text-align: center;
            font-size: 0.95em;
            color: #000000;
            margin: 0 0 2px 0;
            line-height: 1.2;
            font-weight: bold !important;
        }

        .contact-links a {
            color: #000000;
            text-decoration: none;
        }

        h2 {
            font-size: 1.1em;
            font-weight: bold;
            color: ${headingColor};
            border-bottom: 1.5px solid ${headingColor};
            padding-bottom: 1px;
            margin-top: 10px;
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            page-break-after: avoid;
        }

        h3 {
            font-size: 1em;
            font-weight: bold;
            color: #000000;
            margin-top: 5px;
            margin-bottom: 1px;
            page-break-after: avoid;
        }

        p {
            margin: 0 0 3px 0;
            text-align: justify;
        }

        p:empty { display: none; }

        .flex-row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-top: 5px;
            margin-bottom: 2px;
            page-break-after: avoid;
        }

        .flex-row strong {
            font-size: 1em;
            font-weight: bold;
            color: #000000;
        }

        .flex-row em {
            font-size: 1em;
            font-style: italic;
            color: #000000;
        }

        hr { display: none; }

        ul {
            margin: 0 0 4px 0;
            padding-left: 15px;
        }

        li {
            margin-bottom: 2px;
            page-break-inside: avoid;
            text-align: justify;
        }

        h3 + p {
            font-style: italic;
            color: #000000;
            font-size: 0.95em;
            margin-top: 0px;
            margin-bottom: 1px;
        }

        h3 + p + p {
            font-size: 0.95em;
            margin-top: 0px;
            margin-bottom: 2px;
        }

        p a, li a {
            color: #000000;
            text-decoration: none;
        }

        strong { font-weight: bold; }
        em { font-style: italic; }
    </style>
</head>
<body>
    ${bodyContent}
</body>
</html>
`;

// ─── Marked Custom Renderer ───────────────────────────────────────────────────
const renderer = new marked.Renderer();
renderer.paragraph = function (token) {
    const text = this.parser.parseInline(token.tokens);
    if (text.includes('@') && text.includes('|')) {
        return `<p class="contact-details">${text}</p>`;
    }
    if (text.includes('href') && text.includes('|')) {
        return `<p class="contact-links">${text}</p>`;
    }
    return `<p>${text}</p>`;
};

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'MD2CV PDF Server', timestamp: new Date().toISOString() });
});

// ─── PDF Convert Endpoint ─────────────────────────────────────────────────────
app.post('/convert', async (req, res) => {
    try {
        let { markdown, fontFamily, fontSize, lineHeight, marginTB, marginLR, headingColor } = req.body;

        if (!markdown) {
            return res.status(400).json({ error: 'Konten Markdown tidak boleh kosong.' });
        }

        // Apply defaults
        fontFamily   = fontFamily   || 'Arial, Helvetica, sans-serif';
        fontSize     = fontSize     || '8.5';
        lineHeight   = lineHeight   || '1.25';
        marginTB     = marginTB     || '0.8';
        marginLR     = marginLR     || '1.2';
        headingColor = headingColor || '#000000';

        // Pre-process: Name heading + Job Title
        markdown = markdown.replace(
            /^#\s+([^\r\n]+)\s*[\r\n]+\*\*([^\r\n]+)\*\*/m,
            (match, name, title) => `<h1>${name}</h1>\n<div class="job-title">${title}</div>`
        );

        // Pre-process: **Title** + *Date* → flex-row
        markdown = markdown.replace(
            /\*\*(.*?)\*\*\s*[\r\n]+\*([^*]+)\*(?=\s*[\r\n]|$)/g,
            (match, title, date) => {
                if (date.length > 40 || date.toLowerCase().includes('tech stack') || date.toLowerCase().includes('github')) {
                    return match;
                }
                return `<div class="flex-row"><strong>${title}</strong><em>${date}</em></div>`;
            }
        );

        // Convert Markdown → HTML
        const rawHtml = marked.parse(markdown, { renderer, gfm: true, breaks: false });
        const fullHtml = htmlTemplate({ bodyContent: rawHtml, fontFamily, fontSize, lineHeight, marginTB, marginLR, headingColor });

        // Launch Puppeteer
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process'
            ]
        });

        const page = await browser.newPage();
        await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' }
        });

        await browser.close();

        res.contentType('application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Error saat konversi PDF:', error);
        res.status(500).json({ error: error.message || 'Terjadi kesalahan saat membuat PDF.' });
    }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ MD2CV PDF Server berjalan di port ${PORT}`);
});
