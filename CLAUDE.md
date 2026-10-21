# pdf-annotations — Project Guide

Guidance for coding agents and developers working in this repository. This file is tracked, so it
is the copy that survives; the agent norms it adapts are generic and live outside the repo.

## Project

Angular 20.3 single-page app: open a PDF, highlight text, attach Markdown comments, and save the
annotations back into the PDF or to a JSON file.

- Standalone components, **zoneless** (no zone.js), signals, `ChangeDetectionStrategy.OnPush`
  everywhere. No router, no SSR/prerender, no HTTP.
- pdf.js 4 renders the pages, pdf-lib reads and writes the annotations, `marked` renders Markdown.
- A single feature: `annotator`.

## Commands

```bash
npm start                    # dev server
npm run build                # production build
npx ng test --watch=false    # Karma + Jasmine unit specs
npm run e2e                  # Playwright against the dev server on port 4300
npm run e2e:headed           # same, with the browser visible
npx ng lint                  # ESLint, mandatory (npm run lint is the same)
npm run format               # Prettier, writes
npm run format:check         # Prettier, checks only
npm run typecheck:e2e        # type-checks e2e and the config
```

### Verification gate

A change is not done until every command passes on a run you actually executed, in this order:

```
npx ng lint --fix ; npx ng lint   # ESLint is mandatory: --fix first, then read what is left
npx ng test --watch=false         # unit specs
npx ng build                      # AOT compile; strict templates surface only here
npm run format:check
npm run typecheck:e2e             # Playwright transpiles without checking; this checks
npm run e2e                       # real Chromium; whenever the change is visual, timing or focus
```

`ng build` does **not** prerender here (there is no SSR). It is still the only gate that catches a
template type error (`strictTemplates`): a spec can pass against a template that does not build.
Counts may only grow: never drop, skip or loosen a test to get green.

## Folder layout

```
src/app/
  app.ts, app.config.ts                       root (loose, CLI default)
  annotator/<unit>/<unit>.component.{ts,html,scss,spec.ts}   one folder per component
  annotator/annotator.data.ts                 data file (loose, allowed)
  annotator/<helper>/<helper>.ts (+ .spec.ts) helper modules: text-selection, selection-marker,
                                              annotation-file, translatable-error, reading-position,
                                              save-scheduler, scroll-tracker, unreachable-objects,
                                              markdown (pipe)
  annotator/testing/dom-builders/dom-builders.ts  spec-only helpers (excluded from the app build)
  models/annotator.model.ts, models/layout.model.ts   types only, one file per feature
  services/annotator/*.service.ts (+spec)     root services: file access, PDF codec, session
                                              storage (reading position, recovery copy)
  services/layout/*.service.ts (+spec)        preferences: reading mode, sidebar width, language,
                                              autosave
  signals/annotator/annotator.signals.ts (+spec)  the feature store
  signals/annotator/autosave.signals.ts (+spec)   the autosave store (save queue, save status)
  shared/inline-translate-loader/inline-translate-loader.ts (+spec)
src/assets/i18n/es.json, en.json              bundled (imported), not served
e2e/                                          Playwright; e2e/fixtures/ helpers
```

The page is `annotator/annotator/`: every component, the page included, gets its own folder under
`src/app/annotator/`. One folder per unit, named after it; only `*.routes.ts` and data files sit
loose. File name matches the exported class.

## Services vs. stores

- **Services** are `providedIn: 'root'` and talk to the outside world (File System Access API,
  `localStorage`, DOM events). They hold no feature state. The readonly-signal preference services
  in `services/layout/` (reading mode, sidebar width, language, autosave) are the accepted exception: a
  private `_x = signal(...)` published as `readonly x = this._x.asReadonly()`, changed only
  through a method.
- **The stores** (`AnnotatorSignals`, `AutosaveSignals`) are `@Injectable()` with no
  `providedIn`, both listed in `AnnotatorComponent.providers` so they live and die with the
  component. State is a private `_x` published with `asReadonly()`, and every write goes through
  an action method (`setZoom`, `setSearch`, ...). A store never exposes a `WritableSignal`.
- Stores depend on services, never the reverse. Between stores the dependency is one-way:
  `AutosaveSignals` injects `AnnotatorSignals` and changes it only through its actions;
  `AnnotatorSignals` never knows autosave exists.
- Types live only in `models/<feature>.model.ts`, never inside a service, store or component.
- **No fetch shape.** There is no HTTP. File I/O is user-triggered store actions, not
  effect-driven fetches. The one exception is autosave: `AutosaveSignals` watches the annotator
  store's change counter and editor state with effects and schedules writes through its queue. Document loading stays in `PdfViewerComponent`, because a pdf.js
  `PDFDocumentProxy` is a view resource.

## Components

- `protected` for every member only the template uses. `input()`, `output()`, `model()` and
  queries stay public and `readonly`. Specs reach protected members by index
  (`component['x']`).
- Handlers are named for what they do (`changeZoom`, `dismissSelection`), not for the event
  (`onZoomChange`). If a handler only forwards to an existing method, bind that method and delete
  the wrapper. Outputs are not named after DOM events.
- The template reads the store directly (`store.scale()`); do not re-expose store signals as
  component fields. The component keeps view concerns only: DOM adapters, view-local widget
  state, and view models that need `TranslateService`.
- Max **15 methods** per component and max **20 lines** per function as ESLint counts them.
- `inject()`, never constructor parameters. `@if` / `@for (...; track ...)` / `@switch`, never
  `*ngIf` / `*ngFor`. `host` in the decorator, never `@HostBinding` / `@HostListener`. No
  `ngClass` / `ngStyle`. **No `any`.**
- Anything touching `window`, `document`, `localStorage` or `navigator` that could run before the
  browser is guarded; this app is client-only, but keep it SSR-safe by habit.

## i18n

`@ngx-translate/core` with `InlineTranslateLoader` (JSON imported, no HTTP). Keys are
`SCREAMING_SNAKE`, nested by area. Every key goes in both `es.json` and `en.json` in the same edit,
`aria-label` and `title` included. The language comes from the stored choice
(`localStorage['pdf-annotations.language']`), else the browser (`navigator.language` starting with
`es` gives `es`, anything else `en`). The switcher sits in the toolbar; `<html lang>` and the
document title follow the language. Notices and errors are stored as `{ key, params }` and
translated in the template. `confirm()` prompts are built in components with
`TranslateService.instant`.

**Never translated:** what is written into a PDF or a file name (author `T: 'PDF Annotations'`,
the `-anotado.pdf` suffix, `.annotations.json`, the catalog keys).

## Testing

- Karma + Jasmine, kept on purpose. `jasmine.createSpy` / `spyOn`, `jasmine.clock()` for timers.
  Specs sit beside their subject. TestBed is zoneless (`provideZonelessChangeDetection()`).
- Component specs provide the translate service with a fake loader. Assert on `data-testid`,
  never on translated text.
- Stores are driven through their methods, never by writing state directly.
- `PdfViewerComponent` is stubbed in component specs, because pdf.js does not run in Karma.
- **e2e:** Playwright against the dev server on port 4300, `locale: 'es-ES'` pinned. UI controls
  are located by `data-testid`. pdf.js classes (`.textLayer`, `.endOfContent`,
  `.pdf-page__highlight*`) remain CSS locators. The `test.fixme` in
  `e2e/text-selection-adversarial.spec.ts` is deliberate.
- **e2e ownership:** the testing agent owns everything under `e2e/`, helpers in `e2e/fixtures/`
  included. The implementation agent does not edit `e2e/` (the one exception was the mechanical
  whole-codebase Prettier reformat). When a source change needs e2e changes (locators, types,
  lint), the implementation agent hands the testing agent a precise list. `playwright.config.ts`
  is config, not `e2e/`, and belongs to the implementation agent.

## data-testid

`<unit>-<element>[-<variant>]`, on every interactive or assertable element. Bind the id for
repeated elements: `'annotation-card-' + annotation().id`, `'highlight-popup-color-' + color.id`,
`'pdf-page-highlight-' + box.id + '-' + index`. The elements inside an annotation card keep static
ids (`annotation-card-quote`, `-edit`, ...) and are addressed through the card's bound host id:
`getByTestId('annotation-card-<id>').getByTestId('annotation-card-quote')`.

## Accessibility

WCAG 2.1 AA: semantic HTML, a translated accessible name on every control, keyboard operability,
visible focus, contrast AA, and no meaning carried by colour alone. There is no Lighthouse CI here.

## Styling

BEM-lite per component (`.component__element--modifier`), CSS custom properties from
`src/styles.scss`, global `.button` / `.icon-button`. No shared mixins file until a component
needs one.

## Comments

Anything that documents a declaration (class, interface, type, exported const, member, method,
`input()`, `output()`, model field) is a **TSDoc** block in English immediately above it, never a
line comment. TSDoc is mandatory on public and `protected` methods, inputs/outputs, store and
service methods and exported symbols. Say intent, units, edge behaviour and why; do not restate
the signature. `//` is only for explaining a decision inside a body. Comments, TSDoc and commit
messages are English; only user-visible text is Spanish, through the translation bundles.

## Linting

`eslint.config.js` (angular-eslint, flat config) with strict type-checked TypeScript rules and
overrides for `*.spec.ts`, `e2e/**` and `src/**/testing/**`, where `max-lines-per-function` is off.
Never silence a rule to get past it; a disable needs a same-line comment saying why.

## Workflow

- Work on a branch. Agents never commit, push or delete files; the developer or orchestrator does.
  Review scope is `git status --porcelain`, `git diff main...HEAD` and untracked files.
- **File moves** follow the file-move protocol: the implementation agent creates every file at its
  new path and updates every importer in place; the orchestrator, with the developer's standing
  permission, removes the old paths; the implementation agent then runs the full gate.
- Roadmaps live in `.claude/roadmaps/` and are gitignored; never commit them.
- Line endings are LF (`.gitattributes`). The developer may want `git add --renormalize .` on
  the next commit.
- **Commit messages and PR text must not mention or include `Co-Authored-By: Claude` or
  "Generated with Claude Code".** The developer does not want Claude credited in this repository.
