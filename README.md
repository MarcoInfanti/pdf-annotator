# PDF Annotator

**English** · [Español](README.es.md)

A browser-based PDF viewer for highlighting text and adding Markdown comments. Annotations are
saved **inside the PDF itself**, with no database and no server: open the file again and they are
still there.

## Features

- Text highlighting in four colours.
- Markdown comments (tables included) with a live preview; add, edit and delete them.
- Annotations are stored in the PDF in two ways:
  - a full JSON copy, so this app restores them exactly;
  - standard PDF highlight annotations carrying the comment, visible in Acrobat, Edge and other
    readers.
- In Chrome and Edge, saving writes back to the same file (File System Access API); other browsers
  download an annotated copy.
- Export / import annotations as JSON (backups and password-protected PDFs).
- Zoom (Ctrl + wheel, Ctrl +/−, fit to width), Normal / Sepia / Night reading modes, and a
  resizable, searchable sidebar.
- Spanish and English interface, with a language switcher in the toolbar (it follows the browser
  language until you choose one).

## Privacy

Everything runs in your browser: your PDFs are never uploaded anywhere.

## Development

Requires Node.js 20 or later.

```bash
npm install
npm start               # dev server at http://localhost:4200
npm run build           # production build in dist/
npm test                # unit tests (Karma + Jasmine)
npm run lint            # ESLint (mandatory)
npm run format          # Prettier, writes
npm run format:check    # Prettier, checks only
npm run typecheck:e2e   # type-checks the e2e tests and the Playwright config
npm run e2e             # end-to-end tests (Playwright, Chromium)
npm run e2e:headed      # same, with the browser visible
```

Before running the e2e tests for the first time, install the browser with
`npx playwright install chromium`.

Built with Angular 20, [pdf.js](https://mozilla.github.io/pdf.js/) to render PDFs,
[pdf-lib](https://pdf-lib.js.org/) to write annotations, and [marked](https://marked.js.org/) for
Markdown.

## License

[MIT](LICENSE) © 2026 Marco Infanti

Third-party code keeps its own licence: pdf.js and RxJS (Apache-2.0), pdf-lib, marked, Angular and
ngx-translate (MIT), pako (MIT and Zlib), tslib (0BSD). The production build writes every notice to
`3rdpartylicenses.txt` (`extractLicenses` in `angular.json`); ship that file with the app.
